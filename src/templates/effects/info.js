// templates/effects/info.js
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    initSmoothScroll();   // Lenis
    initScrollEffects();  // progress, header shadow, hide/show, scroll-top, fade-in
    initShareButtons();   // copy link, Zalo placeholder
  });

  // -------- Smooth scroll (Lenis) --------
  function initSmoothScroll() {
    if (typeof Lenis === "undefined") return;

    let lenis;
    try {
      lenis = new Lenis({
        lerp: 0.12,
        smoothWheel: true,
        smoothTouch: false
      });
    } catch {
      return;
    }

    // cho debug nếu cần
    window.__lenis = lenis;

    function raf(time) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);
  }

  // -------- Scroll effects: progress + header + scroll-top + fade-in --------
  function initScrollEffects() {
    const header = document.querySelector(".info-header");
    const progressBar = document.getElementById("articleProgress");
    const scrollTopBtn = document.getElementById("scrollTopBtn");
    const animatedEls = document.querySelectorAll("[data-animate]");

    let lastY = window.scrollY || window.pageYOffset || 0;

    function onScroll() {
      const y = window.scrollY || window.pageYOffset || 0;
      const docHeight = document.body.scrollHeight - window.innerHeight;
      const progress = docHeight > 0 ? (y / docHeight) * 100 : 0;

      // progress bar
      if (progressBar) {
        progressBar.style.width = progress + "%";
      }

      // shadow + ẩn/hiện header theo hướng scroll (giống menu index)
      if (header) {
        header.classList.toggle("info-header--shadow", y > 4);

        const goingDown = y > lastY;
        const goingUp = y < lastY;

        if (y < 80) {
          // gần top luôn hiện
          header.classList.remove("info-header--hidden");
        } else {
          if (goingDown && y > 140) {
            // kéo xuống sâu hơn thì ẩn
            header.classList.add("info-header--hidden");
          } else if (goingUp) {
            // kéo ngược lên là hiện lại
            header.classList.remove("info-header--hidden");
          }
        }
      }

      // nút ↑ lên đầu trang
      if (scrollTopBtn) {
        if (y > 260) {
          scrollTopBtn.classList.add("is-visible");
        } else {
          scrollTopBtn.classList.remove("is-visible");
        }
      }

      lastY = y;
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();

    // Scroll lên đầu trang (xài Lenis nếu có)
    if (scrollTopBtn) {
      scrollTopBtn.addEventListener("click", function () {
        const lenis = window.__lenis || window.lenis;
        if (lenis && typeof lenis.scrollTo === "function") {
          lenis.scrollTo(0, {
            duration: 1.0,
            easing: (t) => 1 - Math.pow(1 - t, 3)
          });
        } else {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      });
    }

    // Fade-in cho các block có data-animate
    if ("IntersectionObserver" in window && animatedEls.length) {
      const io = new IntersectionObserver(
        function (entries, observer) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("info-animate-visible");
            observer.unobserve(entry.target);
          });
        },
        { threshold: 0.15 }
      );

      animatedEls.forEach(function (el) {
        io.observe(el);
      });
    } else {
      animatedEls.forEach(function (el) {
        el.classList.add("info-animate-visible");
      });
    }
  }

  // -------- Nút chia sẻ --------
  function initShareButtons() {
    document.addEventListener("click", function (evt) {
      const btn = evt.target.closest(".info-share-btn");
      if (!btn) return;

      const type = btn.dataset.share;

      if (type === "copy") {
        const url = window.location.href;

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard
            .writeText(url)
            .then(function () {
              btn.classList.add("info-share-btn-done");
              btn.textContent = "Đã copy link";
              setTimeout(function () {
                btn.classList.remove("info-share-btn-done");
                btn.textContent = "Copy link";
              }, 2000);
            })
            .catch(function () {
              window.prompt("Copy đường link bài viết:", url);
            });
        } else {
          window.prompt("Copy đường link bài viết:", url);
        }
      } else if (type === "zalo") {
        alert("Bạn có thể tự tích hợp chia sẻ Zalo sau nhé 😄");
      }
    });
  }
})();
