const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");

const port = Number(process.env.PORT) || 3000;
const apiKey = process.env.OPENROUTER_API_KEY;
const accessPassword = process.env.MILLER_ACCESS_PASSWORD;
const maxBodyBytes = 32 * 1024 * 1024;
const sessionDurationMs = 12 * 60 * 60 * 1000;
const sessions = new Map();
const dailyRequests = new Map();
const loginAttempts = new Map();
const allowedModels = new Set([
    "nvidia/nemotron-3-ultra-550b-a55b",
    "openrouter/free",
    "google/gemini-2.5-flash"
]);
const requestLog = new Map();
const staticFiles = new Map([
    ["/", ["index.html", "text/html; charset=utf-8"]],
    ["/index.html", ["index.html", "text/html; charset=utf-8"]],
    ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
    ["/script.js", ["script.js", "text/javascript; charset=utf-8"]]
]);

function sendJson(response, status, data) {
    response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
    });
    response.end(JSON.stringify(data));
}

function clientAddress(request) {
    return request.socket.remoteAddress || "unknown";
}

function isRateLimited(request) {
    const now = Date.now();
    const address = clientAddress(request);
    const recent = (requestLog.get(address) || []).filter((timestamp) => now - timestamp < 60_000);
    if (recent.length >= 20) {
        requestLog.set(address, recent);
        return true;
    }
    const today = new Date().toISOString().slice(0, 10);
    const daily = dailyRequests.get(address);
    if (daily?.day === today && daily.count >= 100) return true;
    recent.push(now);
    requestLog.set(address, recent);
    dailyRequests.set(address, { day: today, count: daily?.day === today ? daily.count + 1 : 1 });
    if (requestLog.size > 1000) {
        for (const [ip, timestamps] of requestLog) {
            if (!timestamps.length || now - timestamps[timestamps.length - 1] >= 60_000) requestLog.delete(ip);
        }
    }
    return false;
}

function getSession(request) {
    const cookie = request.headers.cookie || "";
    const token = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("miller_session="))?.slice("miller_session=".length);
    const session = token && sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
        if (token) sessions.delete(token);
        return false;
    }
    return true;
}

function sendSessionCookie(request, response, token) {
    const secure = request.headers["x-forwarded-proto"] === "https" || request.socket.encrypted;
    response.setHeader("Set-Cookie", `miller_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionDurationMs / 1000}${secure ? "; Secure" : ""}`);
}

async function handleLogin(request, response) {
    if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        return sendJson(response, 405, { error: "Método no permitido." });
    }
    if (!accessPassword) return sendJson(response, 503, { error: "El acceso no está configurado en el servidor." });
    const address = clientAddress(request);
    const attempts = (loginAttempts.get(address) || []).filter((timestamp) => Date.now() - timestamp < 60_000);
    if (attempts.length >= 10) return sendJson(response, 429, { error: "Demasiados intentos. Espera un minuto." });
    attempts.push(Date.now());
    loginAttempts.set(address, attempts);
    if (!request.headers["content-type"]?.includes("application/json")) {
        return sendJson(response, 415, { error: "Se requiere una solicitud JSON." });
    }
    let body;
    try {
        body = await readJson(request);
    } catch (error) {
        return sendJson(response, error.status || 400, { error: error.message });
    }
    const submitted = Buffer.from(typeof body?.password === "string" ? body.password : "");
    const expected = Buffer.from(accessPassword);
    const matches = submitted.length === expected.length && crypto.timingSafeEqual(submitted, expected);
    if (!matches) return sendJson(response, 401, { error: "Contraseña incorrecta." });
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { expiresAt: Date.now() + sessionDurationMs });
    sendSessionCookie(request, response, token);
    return sendJson(response, 200, { ok: true });
}

async function readJson(request) {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > maxBodyBytes) {
            tooLarge = true;
            continue;
        }
        if (!tooLarge) chunks.push(chunk);
    }
    if (tooLarge) {
        const error = new Error("La solicitud supera el tamaño permitido.");
        error.status = 413;
        throw error;
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        const error = new Error("El cuerpo debe ser JSON válido.");
        error.status = 400;
        throw error;
    }
}

async function handleChat(request, response) {
    if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        return sendJson(response, 405, { error: "Método no permitido." });
    }
    if (!accessPassword) return sendJson(response, 503, { error: "El acceso no está configurado en el servidor." });
    if (!getSession(request)) return sendJson(response, 401, { error: "Inicia sesión para usar el chat." });
    if (!apiKey) return sendJson(response, 503, { error: "El servidor no tiene configurada la clave de OpenRouter." });
    if (isRateLimited(request)) return sendJson(response, 429, { error: "Demasiadas solicitudes. Inténtalo de nuevo en un minuto." });
    if (!request.headers["content-type"]?.includes("application/json")) {
        return sendJson(response, 415, { error: "Se requiere una solicitud JSON." });
    }
    if (Number(request.headers["content-length"]) > maxBodyBytes) {
        return sendJson(response, 413, { error: "La solicitud supera el tamaño permitido." });
    }

    let body;
    try {
        body = await readJson(request);
    } catch (error) {
        return sendJson(response, error.status || 400, { error: error.message });
    }

    if (!body || !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 121) {
        return sendJson(response, 400, { error: "La lista de mensajes no es válida." });
    }
    if (!body.messages.every((message) => message
        && ["system", "user", "assistant"].includes(message.role)
        && (typeof message.content === "string" || Array.isArray(message.content)))) {
        return sendJson(response, 400, { error: "El formato de los mensajes no es válido." });
    }

    const model = typeof body.model === "string" && allowedModels.has(body.model)
        ? body.model
        : "nvidia/nemotron-3-ultra-550b-a55b";

    try {
        const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "X-Title": "Miller AI"
            },
            body: JSON.stringify({ model, messages: body.messages, max_tokens: 4000 })
        });
        const result = await upstream.text();
        response.writeHead(upstream.status, {
            "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff"
        });
        response.end(result);
    } catch {
        sendJson(response, 502, { error: "No se pudo conectar con el proveedor de IA." });
    }
}

const server = http.createServer(async (request, response) => {
    let pathname;
    try {
        pathname = new URL(request.url, "http://localhost").pathname;
    } catch {
        return sendJson(response, 400, { error: "URL no válida." });
    }

    if (pathname === "/api/chat") return handleChat(request, response);
    if (pathname === "/api/login") return handleLogin(request, response);
    if (pathname === "/api/session") {
        if (request.method !== "GET") {
            response.setHeader("Allow", "GET");
            return sendJson(response, 405, { error: "Método no permitido." });
        }
        if (!accessPassword) return sendJson(response, 503, { error: "El acceso no está configurado en el servidor." });
        return sendJson(response, getSession(request) ? 200 : 401, { authenticated: getSession(request) });
    }

    const file = staticFiles.get(pathname);
    if (!file || request.method !== "GET" && request.method !== "HEAD") {
        return sendJson(response, 404, { error: "No encontrado." });
    }
    const [filename, contentType] = file;
    try {
        const filePath = path.join(__dirname, filename);
        const content = await require("node:fs/promises").readFile(filePath);
        response.writeHead(200, {
            "Content-Type": contentType,
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "same-origin"
        });
        response.end(request.method === "HEAD" ? undefined : content);
    } catch {
        sendJson(response, 500, { error: "No se pudo cargar la aplicación." });
    }
});

server.listen(port, "0.0.0.0", () => {
    console.log(`Servidor Miller AI disponible en el puerto ${port}.`);
});
