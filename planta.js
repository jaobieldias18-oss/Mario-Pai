/* =====================================================
   planta.js — LER PLANTA (MARIO)
   Fiação da tela-planta: upload, prévia, análise via
   PlantReader e exibição dos dados. Sem dependências
   do resto do app (só usa os estilos/classe existentes).
   ===================================================== */
(function () {
  "use strict";

  var base64 = "";
  var mime = "image/png";
  var nomeArq = "";
  var ultimaAnalise = null;

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function fmtArea(v) {
    return v === null || v === undefined ? "—" : String(v).replace(".", ",") + " m²";
  }

  function confTxt(c) {
    if (c === "alta") return "alta";
    if (c === "media") return "média";
    return "baixa";
  }

  function lerArquivo(f) {
    if (!f) return;
    var nomeBaixo = (f.name || "").toLowerCase();
    if (!/\.(png|jpg|jpeg)$/.test(nomeBaixo) && (f.type || "").indexOf("image/") !== 0) {
      $("planta-prog").innerHTML = "<p><strong>Tipo não aceito.</strong> Envie PNG ou JPG.</p>";
      return;
    }
    if (f.size > 15 * 1024 * 1024) {
      $("planta-prog").innerHTML = "<p><strong>Arquivo muito grande</strong> (máximo 15 MB).</p>";
      return;
    }
    var leitor = new FileReader();
    leitor.onload = function () {
      var url = String(leitor.result || "");
      base64 = url.split(",")[1] || "";
      mime = (url.match(/^data:([^;]+);/) || [])[1] || f.type || "image/png";
      nomeArq = f.name || "planta";
      var prev = $("planta-prev");
      prev.src = url;
      prev.style.display = "block";
      $("planta-info").innerHTML = "<strong>" + esc(nomeArq) + "</strong>";
      $("planta-btn").disabled = false;
      $("planta-prog").innerHTML = "";
      // Aviso de qualidade (sem travar)
      var img = new Image();
      img.onload = function () {
        try {
          var q = PlantReader.avaliarQualidade(img);
          if (!q.ok) {
            $("planta-prog").innerHTML = "<p class=\"texto-suave\">Imagem com baixa qualidade — o resultado pode ficar impreciso.</p>";
          }
        } catch (e) {}
      };
      img.src = url;
    };
    leitor.readAsDataURL(f);
  }

  function analisar() {
    if (!base64) return;
    var btn = $("planta-btn");
    var prog = $("planta-prog");
    btn.disabled = true;
    prog.innerHTML = "<p>Enviando planta...</p>";
    PlantReader.analisarPlanta(
      { nome: nomeArq, mime: mime, base64: base64 },
      function (p) { prog.innerHTML = "<p>" + esc(p.texto || ("Etapa " + p.etapa)) + "</p>"; }
    ).then(function (a) {
      btn.disabled = false;
      ultimaAnalise = a;
      var avisos = PlantReader.checarMatematica(a);
      var h = "<p><strong>Área total:</strong> " + fmtArea(a.area_total) + "</p>";
      if (a.ambientes && a.ambientes.length) {
        h += '<div class="lista">';
        a.ambientes.forEach(function (x) {
          h += '<div class="card" style="margin-bottom:8px"><strong>' + esc(x.nome) + "</strong><br>" +
            '<span class="texto-suave">' + fmtArea(x.area) + " · confiança " + confTxt(x.confianca) + "</span></div>";
        });
        h += "</div>";
      } else {
        h += '<p class="texto-suave">Nenhum cômodo identificado.</p>';
      }
      var extras = [];
      if (a.portas) extras.push("Portas: " + a.portas.qtd);
      if (a.janelas) extras.push("Janelas: " + a.janelas.qtd);
      if (a.quartos !== null) extras.push("Quartos: " + a.quartos);
      if (a.banheiros !== null) extras.push("Banheiros: " + a.banheiros);
      if (extras.length) h += "<p>" + esc(extras.join(" · ")) + "</p>";
      var inc = (a._extras && a._extras.informacoes_incertas) || [];
      if (inc.length) {
        h += "<p><strong>Conferir:</strong></p><ul>" +
          inc.map(function (x) { return "<li class=\"texto-suave\">" + esc(x) + "</li>"; }).join("") + "</ul>";
      }
      if (avisos.length) {
        h += "<p><strong>Avisos:</strong></p><ul>" +
          avisos.map(function (x) { return "<li class=\"texto-suave\">" + esc(x) + "</li>"; }).join("") + "</ul>";
      }
      $("planta-saida").innerHTML = h;
      $("planta-saida-card").hidden = false;
      $("planta-copiar").hidden = false;
      prog.innerHTML = "<p><strong>Análise concluída.</strong></p>";
    }).catch(function (err) {
      btn.disabled = false;
      prog.innerHTML = "<p><strong>" + esc((err && err.mensagem) || "Não foi possível analisar.") + "</strong></p>";
    });
  }

  function copiarResumo() {
    if (!ultimaAnalise) return;
    var a = ultimaAnalise;
    var linhas = ["PLANTA: " + nomeArq, "Área total: " + fmtArea(a.area_total), ""];
    (a.ambientes || []).forEach(function (x) {
      linhas.push(x.nome + ": " + fmtArea(x.area));
    });
    var txt = linhas.join("\n");
    function ok() {
      var p = document.getElementById("planta-prog");
      if (p) p.innerHTML = "<p><strong>Resumo copiado!</strong></p>";
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(ok, function () {});
    }
  }

  function iniciar() {
    var drop = $("planta-drop");
    if (!drop) return;
    drop.addEventListener("click", function () { $("planta-arq").click(); });
    drop.addEventListener("dragover", function (e) { e.preventDefault(); });
    drop.addEventListener("drop", function (e) {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files[0]) lerArquivo(e.dataTransfer.files[0]);
    });
    $("planta-arq").addEventListener("change", function () {
      if (this.files[0]) lerArquivo(this.files[0]);
      this.value = "";
    });
    $("planta-btn").addEventListener("click", analisar);
    $("planta-copiar").addEventListener("click", copiarResumo);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }
})();
