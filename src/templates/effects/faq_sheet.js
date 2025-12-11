// src/templates/effects/faq_sheet.js
// Hiệu ứng cho bottom sheet FAQ: bounce nhẹ khi mở + kéo xuống để đóng.

(function () {
  function initFaqSheetEffects() {
    var sheet = document.getElementById("faqSheet");
    var openBtn = document.getElementById("openFaq");

    if (!sheet || !openBtn) return;

    // =============== Hiệu ứng bounce nhẹ khi mở ===============
    openBtn.addEventListener("click", function () {
      // Cho script kb_ui.js xử lý .open / body.sheet-open,
      // mình chỉ thêm animation transform cho đẹp hơn.
      requestAnimationFrame(function () {
        sheet.style.transformOrigin = "bottom center";
        sheet.style.transition = "transform 260ms cubic-bezier(0.16, 1, 0.3, 1)";
        sheet.style.transform = "translateY(18px) scale(0.98)";

        requestAnimationFrame(function () {
          sheet.style.transform = "translateY(0) scale(1)";
        });

        setTimeout(function () {
          sheet.style.transition = "";
          sheet.style.transform = "";
        }, 280);
      });
    });

    // =============== Drag để đóng bottom sheet ===============
    var header = sheet.querySelector(".faq-header") || sheet;
    var startY = 0;
    var currentY = 0;
    var dragging = false;

    function closeSheet() {
      sheet.classList.remove("open");
      document.body.classList.remove("sheet-open");
    }

    function onPointerDown(e) {
      // Chỉ chuột trái hoặc touch
      if (e.pointerType === "mouse" && e.button !== 0) return;

      var rect = sheet.getBoundingClientRect();

      // Chỉ cho kéo nếu bắt đầu trong vùng trên cùng (~80px) của sheet
      if (e.clientY > rect.top + 80) {
        return;
      }

      dragging = true;
      startY = e.clientY;
      currentY = 0;

      sheet.style.willChange = "transform";
      sheet.style.transition = "none";
      sheet.classList.add("faq-sheet-dragging");

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    }

    function onPointerMove(e) {
      if (!dragging) return;
      currentY = Math.max(0, e.clientY - startY);
      sheet.style.transform = "translateY(" + currentY + "px)";
    }

    function onPointerUp() {
      if (!dragging) return;
      dragging = false;

      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);

      var threshold = 80; // kéo hơn 80px thì đóng sheet

      sheet.style.transition = "transform 220ms ease-out";

      if (currentY > threshold) {
        // Kéo đủ sâu -> animate trượt xuống rồi đóng luôn
        sheet.style.transform = "translateY(100%)";
        setTimeout(function () {
          sheet.style.transition = "";
          sheet.style.transform = "";
          sheet.style.willChange = "";
          sheet.classList.remove("faq-sheet-dragging");
          closeSheet();
        }, 210);
      } else {
        // Kéo chưa đủ -> bật lại vị trí cũ
        sheet.style.transform = "translateY(0)";
        setTimeout(function () {
          sheet.style.transition = "";
          sheet.style.transform = "";
          sheet.style.willChange = "";
          sheet.classList.remove("faq-sheet-dragging");
        }, 220);
      }
    }

    header.addEventListener("pointerdown", onPointerDown);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initFaqSheetEffects);
  } else {
    initFaqSheetEffects();
  }
})();
