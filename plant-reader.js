/* ============================================================
   MARIO · Leitor de Plantas (JS puro, sem dependências)
   Lê plantas de casas com IA (Groq via função segura) e devolve
   dados estruturados: área, cômodos, medidas, confianças.
   Pré-configurado para este projeto. Expõe window.PlantReader.
   A IA LÊ a planta; cálculos ficam no seu sistema.
   ============================================================ */
(function (global) {
  "use strict";

  var TIMEOUT_MS = 120000;
  var TAMANHO_MAXIMO = 15 * 1024 * 1024; // 15 MB
  var CROP_MAX_DIM = 2048;
  var CONFIANCAS = ["alta", "media", "baixa"];

  // Padrões DESTE projeto (podem ser trocados via configurar()).
  // A chave é PÚBLICA (publishable) — nunca a do Groq.
  var PADRAO_URL = "https://wmcrbjlzsqveekwifded.supabase.co/functions/v1/analisar-planta";
  var PADRAO_KEY = "sb_publishable_hNmsPcjC-SKWhQRjd25H3Q_eKevCrOx";

  function arred2(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  function uid(prefixo) {
    return prefixo + "-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 100000).toString(36);
  }

  function ehNumValido(v) {
    return typeof v === "number" && isFinite(v) && v >= 0;
  }

  var _cfg = { functionUrl: PADRAO_URL, apiKey: PADRAO_KEY };

  function ler(key, padrao) {
    try {
      var raw = global.localStorage ? global.localStorage.getItem("mario-planta." + key) : null;
      if (raw === null || raw === undefined) return padrao;
      return JSON.parse(raw);
    } catch (e) { return padrao; }
  }

  function salvar(key, valor) {
    try {
      if (global.localStorage) global.localStorage.setItem("mario-planta." + key, JSON.stringify(valor));
    } catch (e) {}
  }

  function configurar(opcoes) {
    opcoes = opcoes || {};
    if (opcoes.functionUrl !== undefined) _cfg.functionUrl = String(opcoes.functionUrl || "").replace(/\/+$/, "");
    if (opcoes.apiKey !== undefined) _cfg.apiKey = String(opcoes.apiKey || "");
    salvar("cfg", _cfg);
  }

  function config() {
    var salvo = ler("cfg", null);
    if (salvo) {
      if (salvo.functionUrl) _cfg.functionUrl = salvo.functionUrl;
      if (salvo.apiKey) _cfg.apiKey = salvo.apiKey;
    }
    if (!_cfg.functionUrl) _cfg.functionUrl = PADRAO_URL;
    if (!_cfg.apiKey) _cfg.apiKey = PADRAO_KEY;
    return { functionUrl: _cfg.functionUrl, apiKey: _cfg.apiKey };
  }

  function analiseVazia() {
    return {
      area_total: null,
      dimensao_externa_comp: null,
      dimensao_externa_larg: null,
      pe_direito: null,
      parede_comp_total: null,
      telhado_area: null,
      pavimentos: null,
      quartos: null,
      escala: null,
      ambientes: [],
      portas: null,
      janelas: null,
      banheiros: null,
      observacoes: "",
      confianca_geral: "baixa"
    };
  }

  function normalizarRespostaGroq(dados) {
    if (!dados || typeof dados !== "object") return dados;
    var ehGroq = dados.contagens !== undefined || dados.area_construida !== undefined ||
      dados.tipo_planta !== undefined;
    if (!ehGroq || dados._normalizado) return dados;
    function nulo(v) {
      if (v === null || v === undefined) return null;
      if (typeof v === "object" && v !== null && "valor" in v) v = v.valor;
      if (v === null || v === undefined || v === "") return null;
      var n = Number(v);
      return (isFinite(n) && n >= 0) ? n : null;
    }
    function confDe(obj) {
      if (obj && typeof obj === "object" && CONFIANCAS.indexOf(obj.confianca) >= 0) return obj.confianca;
      return "baixa";
    }
    var cont = dados.contagens || {};
    var par = dados.paredes || {};
    var cob = dados.cobertura || {};
    var ext = dados.dimensoes_externas || {};
    function nucleo(novo, legado) {
      var n = nulo(novo);
      if (n !== null) return n;
      if (legado === null || legado === undefined || legado === "") return null;
      if (typeof legado === "object" && "valor" in legado) return nulo(legado);
      var x = Number(legado);
      return (isFinite(x) && x >= 0) ? x : null;
    }
    var portasLeg = (cont.portas === null || cont.portas === undefined || cont.portas === "") ? dados.portas : null;
    var janelasLeg = (cont.janelas === null || cont.janelas === undefined || cont.janelas === "") ? dados.janelas : null;
    function contagem(novo, legado) {
      var v = (novo === null || novo === undefined || novo === "") ? legado : novo;
      if (typeof v === "object" && v !== null) return v;
      if (v === null || v === undefined || v === "") return null;
      return { qtd: v, confianca: "baixa" };
    }
    var conv = {
      _normalizado: true,
      area_total: nucleo(dados.area_construida, dados.area_total),
      dimensao_externa_comp: nucleo(ext.comprimento, null),
      dimensao_externa_larg: nucleo(ext.largura, null),
      pe_direito: null,
      parede_comp_total: nucleo(par.comprimento_total, dados.parede_comp_total),
      telhado_area: nucleo(cob.area, dados.telhado_area),
      pavimentos: nucleo(dados.pavimentos, null),
      escala: (typeof dados.escala === "string") ? dados.escala : null,
      ambientes: Array.isArray(dados.ambientes) ? dados.ambientes.map(function (amb, i) {
        amb = amb || {};
        return {
          nome: String(amb.nome || ("Ambiente " + (i + 1))).slice(0, 40),
          comprimento: nulo(amb.comprimento),
          largura: nulo(amb.largura),
          area: nulo(amb.area),
          confianca: confDe(amb),
          origem: (typeof amb.origem === "string") ? amb.origem : null
        };
      }) : [],
      portas: contagem(cont.portas, portasLeg),
      janelas: contagem(cont.janelas, janelasLeg),
      banheiros: nucleo(cont.banheiros, dados.banheiros),
      quartos: nucleo(cont.quartos, dados.quartos),
      observacoes: Array.isArray(dados.observacoes) ? dados.observacoes.join("; ").slice(0, 500) : (dados.observacoes || ""),
      confianca_geral: "baixa"
    };
    conv._extras = {
      tipo_planta: dados.tipo_planta || null,
      area_util: nulo(dados.area_util),
      contagens: cont,
      paredes_espessura: (par.espessura === null || par.espessura === undefined) ? null : par.espessura,
      cobertura_tipo: cob.tipo || null,
      instalacoes: dados.instalacoes || null,
      medidas_identificadas: Array.isArray(dados.medidas_identificadas) ? dados.medidas_identificadas : [],
      informacoes_incertas: Array.isArray(dados.informacoes_incertas) ? dados.informacoes_incertas : [],
      possiveis_inconsistencias: Array.isArray(dados.possiveis_inconsistencias) ? dados.possiveis_inconsistencias : [],
      areas_adicionais: Array.isArray(dados.areas_adicionais) ? dados.areas_adicionais : []
    };
    return conv;
  }

  function validarAnalise(dados) {
    var erros = [];
    var a = analiseVazia();
    if (!dados || typeof dados !== "object") {
      return { ok: false, analise: a, erros: ["Resposta da análise vazia ou inválida."] };
    }
    var camposNum = ["area_total", "dimensao_externa_comp", "dimensao_externa_larg",
      "pe_direito", "parede_comp_total", "telhado_area", "pavimentos", "quartos", "banheiros"];
    var i;
    for (i = 0; i < camposNum.length; i++) {
      var c = camposNum[i];
      var v = dados[c];
      if (v === null || v === undefined || v === "") { a[c] = null; continue; }
      v = Number(v);
      if (!ehNumValido(v)) { erros.push("Valor inválido para " + c + "."); a[c] = null; continue; }
      a[c] = v;
    }
    if (typeof dados.escala === "string") a.escala = dados.escala.slice(0, 20);
    if (typeof dados.observacoes === "string") a.observacoes = dados.observacoes.slice(0, 500);
    if (CONFIANCAS.indexOf(dados.confianca_geral) >= 0) a.confianca_geral = dados.confianca_geral;
    if (dados.ambientes !== undefined && dados.ambientes !== null) {
      if (!Array.isArray(dados.ambientes)) {
        erros.push("Lista de ambientes inválida.");
      } else {
        for (i = 0; i < dados.ambientes.length; i++) {
          var amb = dados.ambientes[i] || {};
          var nome = String(amb.nome || ("Ambiente " + (i + 1))).slice(0, 40);
          var comp = amb.comprimento === null || amb.comprimento === undefined ? null : Number(amb.comprimento);
          var larg = amb.largura === null || amb.largura === undefined ? null : Number(amb.largura);
          var conf = CONFIANCAS.indexOf(amb.confianca) >= 0 ? amb.confianca : "baixa";
          if ((comp !== null && !ehNumValido(comp)) || (larg !== null && !ehNumValido(larg))) {
            erros.push("Dimensões inválidas no ambiente " + nome + ".");
            continue;
          }
          var area = null;
          if (comp !== null && larg !== null) area = arred2(comp * larg);
          else if (amb.area !== null && amb.area !== undefined && ehNumValido(Number(amb.area))) area = Number(amb.area);
          var item = { nome: nome, comprimento: comp, largura: larg, area: area, confianca: conf };
          if (typeof amb.origem === "string") item.origem = amb.origem;
          a.ambientes.push(item);
        }
      }
    }
    ["portas", "janelas"].forEach(function (k) {
      var p = dados[k];
      if (p === null || p === undefined) return;
      var qtd = (typeof p === "object") ? Number(p.qtd) : Number(p);
      if (!ehNumValido(qtd)) { erros.push("Quantidade inválida: " + k + "."); return; }
      var cf = (typeof p === "object" && CONFIANCAS.indexOf(p.confianca) >= 0) ? p.confianca : "baixa";
      a[k] = { qtd: Math.round(qtd), confianca: cf };
    });
    if (dados._extras) a._extras = dados._extras;
    if (dados._normalizado) a._normalizado = true;
    return { ok: erros.length === 0, analise: a, erros: erros };
  }

  function validarMatematica(a) {
    var avisos = [];
    var i, somaAmb = 0;
    var nomes = {};
    for (i = 0; i < a.ambientes.length; i++) {
      var amb = a.ambientes[i];
      var chave = amb.nome.trim().toLowerCase();
      if (nomes[chave]) avisos.push('Ambiente duplicado: "' + amb.nome + '". Confira.');
      nomes[chave] = true;
      if (amb.area !== null) { somaAmb += amb.area; }
      if ((amb.comprimento !== null && amb.comprimento > 30) || (amb.largura !== null && amb.largura > 30)) {
        avisos.push('Dimensão improvável em "' + amb.nome + '". Confira se está em metros.');
      }
    }
    somaAmb = arred2(somaAmb);
    if (a.area_total !== null && somaAmb > a.area_total * 1.05) {
      avisos.push("Área indicada na planta: " + a.area_total + " m²; soma dos ambientes: " +
        String(somaAmb).replace(".", ",") + " m². Confira antes de usar.");
    }
    if (a.ambientes.length === 0 && a.area_total === null) {
      avisos.push("Poucas informações identificadas.");
    }
    return avisos;
  }

  function normalizarMedida(valor, unidade) {
    if (valor === null || valor === undefined || valor === "") return null;
    var n;
    if (typeof valor === "number") { n = valor; }
    else {
      var txt = String(valor).trim().toLowerCase().replace(",", ".");
      var m = txt.match(/^([\d.]+)\s*(mm|cm|m)?$/);
      if (!m) return null;
      n = parseFloat(m[1]);
      if (!isFinite(n)) return null;
      var u = m[2] || unidade || "m";
      if (u === "mm") n = n / 1000;
      else if (u === "cm") n = n / 100;
    }
    if (!isFinite(n) || n < 0) return null;
    return arred2(n);
  }

  function avaliarQualidade(img) {
    try {
      if (typeof document === "undefined") return { ok: true, motivo: "não avaliado" };
      var c = document.createElement("canvas");
      var ctx = c.getContext("2d");
      var w = 160, h = Math.max(1, Math.round(160 * (img.height / img.width)));
      c.width = w; c.height = h;
      ctx.drawImage(img, 0, 0, w, h);
      var d = ctx.getImageData(0, 0, w, h).data;
      var cinza = [], i;
      for (i = 0; i < d.length; i += 4) cinza.push((d[i] + d[i + 1] + d[i + 2]) / 3);
      var variancia = 0;
      for (i = 1; i < cinza.length - 1; i++) {
        variancia += Math.abs(cinza[i - 1] + cinza[i + 1] - 2 * cinza[i]);
      }
      variancia /= cinza.length;
      if (w < 100 || variancia < 1.2) return { ok: false, motivo: "baixa" };
      return { ok: true, motivo: "boa" };
    } catch (e) {
      return { ok: true, motivo: "não avaliado" };
    }
  }

  function normalizarSelecao(imgW, imgH, sel) {
    if (!sel || !(sel.w > 10) || !(sel.h > 10)) return null;
    var x = Math.max(0, Math.min(Math.round(sel.x), imgW - 1));
    var y = Math.max(0, Math.min(Math.round(sel.y), imgH - 1));
    var w = Math.round(Math.min(sel.w, imgW - x));
    var h = Math.round(Math.min(sel.h, imgH - y));
    if (w < 10 || h < 10) return null;
    return { x: x, y: y, w: w, h: h };
  }

  function dimensoesEnvio(w, h, maxDim) {
    var max = maxDim || CROP_MAX_DIM;
    var m = Math.max(w, h);
    if (m <= max) return { w: w, h: h };
    var f = max / m;
    return { w: Math.max(1, Math.round(w * f)), h: Math.max(1, Math.round(h * f)) };
  }

  function analiseVaziaDeConteudo(a) {
    if (!a) return true;
    return (a.ambientes || []).length === 0 && a.area_total === null &&
      a.parede_comp_total === null && a.dimensao_externa_comp === null;
  }

  function analisarPlanta(entrada, progresso) {
    function avisar(etapa, texto) {
      if (typeof progresso === "function") {
        try { progresso({ etapa: etapa, texto: texto }); } catch (e) {}
      }
    }
    return new Promise(function (resolver, rejeitar) {
      var cfg = config();
      if (!cfg.functionUrl) {
        rejeitar({ codigo: "sem_backend", mensagem: "Função de análise não configurada." });
        return;
      }
      if (!entrada || !entrada.base64) {
        rejeitar({ codigo: "arquivo", mensagem: "Arquivo da planta inválido." });
        return;
      }
      if (entrada.tamanho && entrada.tamanho > TAMANHO_MAXIMO) {
        rejeitar({ codigo: "arquivo", mensagem: "Arquivo muito grande (máximo 15 MB)." });
        return;
      }
      avisar(1, "Enviando planta...");
      var controle = null;
      try {
        if (typeof AbortController !== "undefined") controle = new AbortController();
      } catch (e) {}
      var timer = null;
      if (controle) {
        timer = setTimeout(function () { try { controle.abort(); } catch (e) {} }, TIMEOUT_MS);
      }
      avisar(2, "Analisando imagem...");
      var cabecalhos = { "Content-Type": "application/json" };
      if (cfg.apiKey) cabecalhos.apikey = cfg.apiKey;
      fetch(cfg.functionUrl, {
        method: "POST",
        headers: cabecalhos,
        body: JSON.stringify({
          nome_arquivo: entrada.nome || "planta",
          mime: entrada.mime || "image/png",
          imagem_base64: entrada.base64
        }),
        signal: controle ? controle.signal : undefined
      }).then(function (resp) {
        if (timer) clearTimeout(timer);
        if (!resp.ok) {
          return resp.json().then(function (j) {
            var msg = (j && j.erro) || "Servidor de análise respondeu com erro (" + resp.status + ").";
            throw { codigo: "http", mensagem: msg };
          });
        }
        return resp.json();
      }).then(function (json) {
        avisar(3, "Identificando medidas...");
        avisar(4, "Identificando ambientes...");
        var v = validarAnalise(normalizarRespostaGroq(json && json.analise ? json.analise : json));
        if (analiseVaziaDeConteudo(v.analise)) {
          throw { codigo: "vazia", mensagem: "Não foi possível identificar uma planta baixa na imagem. Verifique se a imagem está legível e tente novamente." };
        }
        resolver(v.analise);
      }).catch(function (err) {
        if (timer) clearTimeout(timer);
        if (err && (err.codigo === "http" || err.codigo === "vazia")) { rejeitar(err); return; }
        var msg = "Falha de conexão com o servidor de análise.";
        if (err && err.name === "AbortError") msg = "A análise demorou demais. Tente novamente com uma imagem menor.";
        rejeitar({ codigo: "rede", mensagem: msg });
      });
    });
  }

  global.PlantReader = {
    configurar: configurar,
    config: config,
    analisarPlanta: analisarPlanta,
    validar: validarAnalise,
    checarMatematica: validarMatematica,
    normalizarMedida: normalizarMedida,
    normalizarSelecao: normalizarSelecao,
    dimensoesEnvio: dimensoesEnvio,
    avaliarQualidade: avaliarQualidade,
    analiseVazia: analiseVazia,
    vazia: analiseVaziaDeConteudo,
    CONFIANCAS: CONFIANCAS
  };
})(typeof window !== "undefined" ? window : this);
