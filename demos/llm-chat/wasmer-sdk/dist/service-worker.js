/*
 * Browser HTTP ingress for @wasmer/sdk.
 *
 * Import this module from a same-origin service worker registered with scope
 * `/`. It deliberately has no dependency on the Wasmer runtime: the worker
 * only transports Fetch requests to a page-owned sandbox over MessagePort.
 */
const scope = globalThis;
let activeRoute;
const REQUEST_TIMEOUT_MS = 300_000;
scope.addEventListener("install", ((event) => {
    event.waitUntil(scope.skipWaiting());
}));
scope.addEventListener("activate", ((event) => {
    event.waitUntil(scope.clients.claim());
}));
scope.addEventListener("message", ((event) => {
    const message = event.data;
    if (!message || typeof message !== "object")
        return;
    if (message.type === "wasmer-sdk:http-register") {
        const port = event.ports[0];
        if (!port || typeof message.serverId !== "string") {
            return;
        }
        event.waitUntil((async () => {
            await recoverRoute();
            if (activeRoute) {
                port.postMessage({
                    type: "wasmer-sdk:http-error",
                    serverId: message.serverId,
                    error: "this service worker already exposes another guest server",
                });
                port.close();
                return;
            }
            registerRoute(message.serverId, port);
        })());
    }
}));
function registerRoute(id, port) {
    const route = { id, port, pending: new Map() };
    activeRoute = route;
    port.addEventListener("message", (event) => {
        receiveResponse(route, event.data);
    });
    port.start();
    port.postMessage({ type: "wasmer-sdk:http-ready", serverId: id });
    return route;
}
let recovery;
function recoverRoute() {
    if (activeRoute)
        return Promise.resolve(activeRoute);
    if (!recovery) {
        recovery = discoverRoute().finally(() => { recovery = undefined; });
    }
    return recovery;
}
async function discoverRoute() {
    const clients = await scope.clients.matchAll({ type: "window", includeUncontrolled: true });
    const hosts = clients.filter((client) => new URL(client.url).pathname === "/.wasmer/host.html");
    await Promise.all(hosts.map((client) => new Promise((resolve) => {
        const channel = new MessageChannel();
        const finish = () => {
            clearTimeout(timer);
            channel.port1.close();
            resolve();
        };
        const timer = setTimeout(finish, 5_000);
        channel.port1.onmessage = (event) => {
            const port = event.ports[0];
            if (port && typeof event.data?.serverId === "string") {
                if (!activeRoute)
                    registerRoute(event.data.serverId, port);
                else
                    port.close();
            }
            finish();
        };
        client.postMessage({ type: "wasmer-sdk:http-recover" }, [channel.port2]);
    })));
    return activeRoute;
}
scope.addEventListener("fetch", ((event) => {
    const url = new URL(event.request.url);
    // Keep the cross-origin control document reachable while the guest owns `/`.
    if (url.pathname.startsWith("/.wasmer/"))
        return;
    event.respondWith((async () => {
        const route = activeRoute ?? await recoverRoute();
        // With no live owner, preserve the host's normal inactive-server response.
        if (!route)
            return fetch(event.request);
        return forwardRequest(route, event.request, url.pathname + url.search);
    })());
}));
async function forwardRequest(route, request, path) {
    const requestId = crypto.randomUUID();
    const body = new Uint8Array(await request.arrayBuffer());
    const response = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            route.pending.delete(requestId);
            reject(new Error(`guest HTTP request exceeded ${REQUEST_TIMEOUT_MS}ms`));
        }, REQUEST_TIMEOUT_MS);
        route.pending.set(requestId, { resolve, reject, timer });
    });
    route.port.postMessage({
        type: "wasmer-sdk:http-request",
        serverId: route.id,
        requestId,
        method: request.method,
        path,
        headers: [...request.headers.entries()],
        body,
    }, [body.buffer]);
    try {
        return await response;
    }
    catch (error) {
        return new Response(error instanceof Error ? error.message : String(error), {
            status: 502,
            headers: {
                "content-type": "text/plain; charset=utf-8",
                "cross-origin-embedder-policy": "require-corp",
                "cross-origin-opener-policy": "same-origin",
                "cross-origin-resource-policy": "cross-origin",
            },
        });
    }
}
function receiveResponse(route, value) {
    const message = value;
    if (!message ||
        message.type !== "wasmer-sdk:http-response" ||
        message.serverId !== route.id ||
        typeof message.requestId !== "string") {
        if (message?.type === "wasmer-sdk:http-close" && message.serverId === route.id) {
            closeRoute(route.id);
        }
        return;
    }
    const pending = route.pending.get(message.requestId);
    if (!pending)
        return;
    route.pending.delete(message.requestId);
    clearTimeout(pending.timer);
    if (message.error) {
        pending.reject(new Error(message.error));
        return;
    }
    const status = message.status ?? 502;
    const bodyAllowed = status >= 200 && status !== 204 && status !== 205 && status !== 304;
    const body = message.body ? Uint8Array.from(message.body).buffer : null;
    const headers = new Headers(message.headers);
    // Preserve cross-origin isolation when the host page uses SharedArrayBuffer.
    headers.set("cross-origin-embedder-policy", "require-corp");
    headers.set("cross-origin-opener-policy", "same-origin");
    // The HTTP host may live on a dedicated origin and be embedded by the app.
    headers.set("cross-origin-resource-policy", "cross-origin");
    pending.resolve(new Response(bodyAllowed ? body : null, {
        status,
        statusText: message.statusText,
        headers,
    }));
}
function closeRoute(id) {
    const route = activeRoute;
    if (!route || route.id !== id)
        return;
    activeRoute = undefined;
    for (const pending of route.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("the Wasmer browser server was closed"));
    }
    route.pending.clear();
    route.port.close();
}
export {};
//# sourceMappingURL=service-worker.js.map