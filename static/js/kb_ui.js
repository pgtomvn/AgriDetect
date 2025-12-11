// static/js/kb_ui.js
// Render FAQ (card + accordion + search) và bắt sự kiện mở/đóng bottom-sheet.

(function () {
  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function initKbFaq() {
    var sheet     = document.getElementById("faqSheet");
    var openBtn   = document.getElementById("openFaq");
    var closeBtn  = document.getElementById("closeFaq");
    var faqListEl = document.getElementById("faqList");
    var searchEl  = document.getElementById("faqSearch");

    if (!sheet || !openBtn || !faqListEl) return;

    var kb = window.AG_KB || {};
    var allFaqs = Array.isArray(kb.faq) ? kb.faq.slice() : [];

    // ========= RENDER LIST =========
    function renderFaqList(term) {
      var q = (term || "").trim().toLowerCase();

      if (!allFaqs.length) {
        faqListEl.innerHTML =
          '<p class="faq-empty">Chưa có câu hỏi thường gặp cho bệnh này.</p>';
        return;
      }

      var filtered = q
        ? allFaqs.filter(function (item) {
            var qs = String(item.q || "").toLowerCase();
            var as = String(item.a || "").toLowerCase();
            return qs.indexOf(q) !== -1 || as.indexOf(q) !== -1;
          })
        : allFaqs;

      if (!filtered.length) {
        faqListEl.innerHTML =
          '<p class="faq-empty">Không tìm thấy câu hỏi phù hợp. Thử từ khóa khác nhé.</p>';
        return;
      }

      var html = "";
      filtered.forEach(function (item, i) {
        var realIndex = allFaqs.indexOf(item);
        if (realIndex === -1) realIndex = i;

        var indexLabel = String(realIndex + 1).padStart(2, "0");
        var qSafe = escapeHtml(item.q || "");
        var aSafe = escapeHtml(item.a || "");

        html +=
          '<article class="faq-card" data-index="' +
          realIndex +
          '">' +
          '<button class="faq-summary" type="button">' +
          '<span class="faq-index">' +
          indexLabel +
          "</span>" +
          '<span class="faq-question">' +
          qSafe +
          "</span>" +
          '<span class="faq-icon" aria-hidden="true">+</span>' +
          "</button>" +
          '<div class="faq-body">' +
          "<p>" +
          aSafe +
          "</p>" +
          "</div>" +
          "</article>";
      });

      faqListEl.innerHTML = html;

      // Stagger animation
      var cards = faqListEl.querySelectorAll(".faq-card");
      cards.forEach(function (card, i) {
        card.style.setProperty("--faq-delay", i * 40 + "ms");
      });
    }

    // ========= OPEN / CLOSE SHEET =========
    function openSheet() {
      sheet.classList.add("open");
      document.body.classList.add("sheet-open");

      // focus vào ô search cho tiện (nếu có)
      if (searchEl) {
        setTimeout(function () {
          try {
            searchEl.focus();
          } catch (e) {}
        }, 120);
      }
    }

    function closeSheet() {
      sheet.classList.remove("open");
      document.body.classList.remove("sheet-open");
    }

    openBtn.addEventListener("click", function (e) {
      e.preventDefault();
      openSheet();
    });

    if (closeBtn) {
      closeBtn.addEventListener("click", function (e) {
        e.preventDefault();
        closeSheet();
      });
    }

    // ESC để đóng
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeSheet();
      }
    });

    // ========= ACCORDION =========
    faqListEl.addEventListener("click", function (e) {
      var summary = e.target.closest(".faq-summary");
      if (!summary) return;

      var card = summary.closest(".faq-card");
      if (!card) return;

      var isOpen = card.classList.contains("open");

      // đóng tất cả trước
      faqListEl
        .querySelectorAll(".faq-card.open")
        .forEach(function (el) {
          el.classList.remove("open");
        });

      // nếu trước đó đang đóng thì mở
      if (!isOpen) {
        card.classList.add("open");
      }
    });

    // ========= SEARCH =========
    if (searchEl) {
      searchEl.addEventListener("input", function () {
        renderFaqList(this.value);
      });
    }

    // Render lần đầu (không filter)
    renderFaqList("");
  }

  // Chờ trang load xong (lúc này script set window.AG_KB đã chạy)
  if (document.readyState === "complete" || document.readyState === "interactive") {
    // hơi trễ 1 tick cho chắc
    setTimeout(initKbFaq, 0);
  } else {
    window.addEventListener("load", initKbFaq);
  }
})();
