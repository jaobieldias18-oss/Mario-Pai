/* =====================================================
   MARIO · Service Worker — SOMENTE acelera arquivos ESTÁTICOS.
   -----------------------------------------------------
   Regras de segurança (para não quebrar o financeiro):
   1. Pedidos ao Supabase (supabase.co): SEMPRE rede, nunca cache.
   2. Escritas (POST/PUT/PATCH/DELETE): nunca interceptadas.
   3. HTML/navegação: rede primeiro (o app nunca fica preso
      numa versão velha guardada no cache).
   4. CSS/JS/imagens do próprio site: sai do cache na hora
      e atualiza em segundo plano (rápido + sempre novo).
   ===================================================== */

const VERSAO_CACHE = "mario-v9";

// Arquivos do "esqueleto" do app (nada de dados financeiros aqui)
const ESTATICOS = [
  "./",
  "index.html",
  "style.css",
  "script.js",
  "supabase.js",
  "outbox.js",
  "manifest.json",
  "assets/logo.svg",
  "assets/logo-claro.svg",
  "assets/icone.svg",
  "assets/favicon-32.png",
  "assets/icone-180.png",
  "assets/icone-192.png",
  "assets/icone-512.png",
  "assets/icone-maskable-512.png",
];

// Instalação: guarda o esqueleto no cache
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSAO_CACHE)
      .then((cache) => cache.addAll(ESTATICOS))
      .then(() => self.skipWaiting())
  );
});

// Ativação: apaga caches de versões antigas
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((chaves) =>
        Promise.all(chaves.filter((k) => k !== VERSAO_CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

function guardarNoCache(requisicao, resposta) {
  if (resposta && resposta.ok) {
    const copia = resposta.clone();
    caches.open(VERSAO_CACHE).then((cache) => cache.put(requisicao, copia));
  }
  return resposta;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 1. Dados financeiros e escritas: deixa passar direto (sem tocar)
  if (event.request.method !== "GET") return;
  if (url.hostname.indexOf("supabase.co") !== -1) return;

  // 2. Navegação/HTML: tenta a rede; sem internet, usa o guardado
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((resposta) => guardarNoCache("index.html", resposta))
        .catch(() => caches.match("index.html"))
    );
    return;
  }

  // 3. Arquivos do próprio site: responde do cache e atualiza por trás
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((doCache) => {
        const daRede = fetch(event.request)
          .then((resposta) => guardarNoCache(event.request, resposta))
          .catch(() => doCache);
        return doCache || daRede;
      })
    );
    return;
  }

  // 4. CDN (supabase-js tem versão fixa na URL): cache, rede como reserva
  event.respondWith(
    caches.match(event.request).then(
      (doCache) =>
        doCache ||
        fetch(event.request).then((resposta) => guardarNoCache(event.request, resposta))
    )
  );
});
