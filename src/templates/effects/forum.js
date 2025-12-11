// ==================== DIỄN ĐÀN NÔNG NGHIỆP – JS ====================
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    initSmoothScroll();
    initForumAnimations();
    initCountUp();
    initForumVideo();
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

    // cho bạn debug nếu cần
    window.__lenis = lenis;

    if (window.gsap && window.ScrollTrigger) {
      lenis.on("scroll", ScrollTrigger.update);

      gsap.ticker.add(function (time) {
        lenis.raf(time * 1000);
      });
      gsap.ticker.lagSmoothing(0);
    } else {
      function raf(time) {
        lenis.raf(time);
        requestAnimationFrame(raf);
      }
      requestAnimationFrame(raf);
    }
  }

  // -------- GSAP scroll animations --------
  function initForumAnimations() {
    if (!window.gsap || !window.ScrollTrigger) {
      lightRevealFallback();
      return;
    }

    gsap.registerPlugin(ScrollTrigger);

    const root = document.querySelector("#screen-forum");
    if (!root) return;

    // Fade-in cho các block chính (trừ banner – có timeline riêng)
    const sections = root.querySelectorAll(
      ".forum-hero, .forum-about, .forum-macro-metric, .forum-resources"
    );

    sections.forEach(function (section, index) {
      gsap.from(section, {
        autoAlpha: 0,
        y: 40,
        duration: 0.9,
        ease: "power3.out",
        delay: index === 0 ? 0.15 : 0,
        scrollTrigger: {
          trigger: section,
          start: "top 82%",
          toggleActions: "play none none reverse"
        }
      });
    });

    // Banner full-bleed kiểu Kettmeir (pin + zoom-out nhẹ)
    // Banner full-bleed kiểu Kettmeir (pin + zoom-out nhẹ)
    // Banner full-bleed kiểu Kettmeir (pin + zoom + text chạy ngang)
    // Banner full-bleed kiểu Kettmeir (zoom theo scroll, không pin)
// Banner Việt Nam – zoom + chữ fade-in theo scroll, không pin
    const photoSection = root.querySelector(".forum-photo-expand");
    if (photoSection && window.gsap && window.ScrollTrigger) {
      const inner = photoSection.querySelector(".forum-photo-inner");
      const caption = photoSection.querySelector(".forum-photo-caption");
      const strip = photoSection.querySelector(".forum-photo-strip");

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: photoSection,
          start: "top 90%",     // vừa lướt tới là bắt đầu zoom
          end: "bottom top",    // hết banner là zoom xong
          scrub: true
          // không pin để khỏi bị "khóa" màn & giật giật
        }
      });

      if (inner) {
        tl.fromTo(
          inner,
          { scale: 1.5, y: 40 },
          { scale: 1.05, y: 0, ease: "power2.out" },
          0
        );
      }

      if (caption) {
        tl.fromTo(
          caption,
          { autoAlpha: 0, y: 40 },
          { autoAlpha: 1, y: 0, ease: "power2.out" },
          0.1
        );
      }

      if (strip) {
        tl.fromTo(
          strip,
          { xPercent: -10 },
          { xPercent: 0, ease: "none" },
          0.1
        );
      }
    }

// Stagger cards
    const postCards = root.querySelectorAll(".forum-post-card");
    if (postCards.length) {
      gsap.from(postCards, {
        autoAlpha: 0,
        y: 26,
        duration: 0.6,
        ease: "power3.out",
        stagger: 0.08,
        scrollTrigger: {
          trigger: postCards[0].closest(".forum-column") || postCards[0],
          start: "top 85%",
          toggleActions: "play none none reverse"
        }
      });
    }

    const docCards = root.querySelectorAll(".forum-doc-card");
    if (docCards.length) {
      gsap.from(docCards, {
        autoAlpha: 0,
        y: 26,
        duration: 0.6,
        ease: "power3.out",
        stagger: 0.08,
        scrollTrigger: {
          trigger: docCards[0].closest(".forum-column") || docCards[0],
          start: "top 85%",
          toggleActions: "play none none reverse"
        }
      });
    }

    // Parallax nhẹ cho hero video + hero text
    const hero = root.querySelector(".forum-hero");
    const videoCard = root.querySelector(".forum-video-card");
    const heroMain = root.querySelector(".forum-hero-main");

    if (hero && videoCard) {
      gsap.to(videoCard, {
        y: -40,
        scale: 1.04,
        rotateX: 6,
        rotateY: -4,
        transformOrigin: "center center",
        ease: "none",
        scrollTrigger: {
          trigger: hero,
          start: "top top",
          end: "bottom top",
          scrub: true
        }
      });
    }

    if (hero && heroMain) {
      gsap.to(heroMain, {
        y: 18,
        ease: "none",
        scrollTrigger: {
          trigger: hero,
          start: "top bottom",
          end: "bottom top",
          scrub: true
        }
      });
    }

    // Float + trôi ngang nhẹ cho các phần tử có data-scroll-float
    root.querySelectorAll("[data-scroll-float]").forEach(function (el, index) {
      const strengthMap = { xs: 10, sm: 18, md: 26, lg: 36 };
      const strength = strengthMap[el.dataset.scrollFloat] || 18;

      const offsetY = strength;
      const offsetX = strength * 0.4 * (index % 2 === 0 ? 1 : -1);

      gsap.fromTo(
        el,
        { y: offsetY, x: -offsetX },
        {
          y: -offsetY,
          x: offsetX,
          ease: "none",
          scrollTrigger: {
            trigger: el,
            start: "top 90%",
            end: "bottom 10%",
            scrub: true
          }
        }
      );
    });
  }

  // Fallback nếu không có GSAP: fade-in nhẹ
  function lightRevealFallback() {
    const root = document.querySelector("#screen-forum");
    if (!root || !("IntersectionObserver" in window)) return;

    const targets = root.querySelectorAll(
      ".forum-hero, .forum-photo-expand, .forum-about, .forum-macro-metric, .forum-resources, .forum-card-list > *"
    );

    targets.forEach(function (el) {
      el.style.opacity = "0";
      el.style.transform = "translateY(24px)";
    });

    const observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.style.transition =
              "opacity 460ms ease-out, transform 460ms ease-out";
            entry.target.style.opacity = "1";
            entry.target.style.transform = "translateY(0)";
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.2 }
    );

    targets.forEach(function (el) {
      observer.observe(el);
    });
  }

  // -------- Count up metrics --------
  function initCountUp() {
    const counters = document.querySelectorAll("[data-count-target]");
    if (!counters.length) return;

    function easeOutCubic(t) {
      return 1 - Math.pow(1 - t, 3);
    }

    function animate(el) {
      const target = Number(el.dataset.countTarget || "0");
      const duration = Number(el.dataset.countDuration || "1200");
      const suffix = el.dataset.countSuffix || "";
      const start = 0;
      const startTime = performance.now();

      function step(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = easeOutCubic(progress);
        const value = Math.floor(start + (target - start) * eased);

        el.textContent = value.toLocaleString("vi-VN") + suffix;

        if (progress < 1) {
          requestAnimationFrame(step);
        }
      }

      requestAnimationFrame(step);
    }

    const observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && !entry.target.dataset.countDone) {
            entry.target.dataset.countDone = "1";
            animate(entry.target);
          }
        });
      },
      { threshold: 0.5 }
    );

    counters.forEach(function (el) {
      observer.observe(el);
    });
  }

  // -------- Video hero (YouTube embed) --------
  function initForumVideo() {
    const card = document.querySelector(".forum-video-card[data-video-id]");
    if (!card) return;

    const playBtn = card.querySelector(".forum-video-play");
    if (!playBtn) return;

    playBtn.addEventListener("click", function () {
      const videoId = card.dataset.videoId;
      if (!videoId) return;

      card.classList.add("is-playing");

      const iframe = document.createElement("iframe");
      iframe.src =
        "https://www.youtube.com/embed/" +
        encodeURIComponent(videoId) +
        "?autoplay=1&rel=0";
      iframe.setAttribute("title", "Video nông nghiệp");
      iframe.setAttribute(
        "allow",
        "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      );
      iframe.setAttribute("allowfullscreen", "true");

      while (card.firstChild) {
        card.removeChild(card.firstChild);
      }
      card.appendChild(iframe);
    });
  }
})();

// Hero video – auto play muted khi card vào viewport, click để mở tiếng
document.addEventListener("DOMContentLoaded", function () {
  const screen = document.getElementById("screen-forum");
  if (!screen) return;

  const card = screen.querySelector(".forum-video-card");
  const video = screen.querySelector(".forum-video-bg");
  const playBtn = screen.querySelector(".forum-video-play");

  if (!card || !video) return;

  // đảm bảo option
  video.muted = true;
  video.loop = true;
  video.playsInline = true; // iOS
  // nếu bạn không muốn browser auto play ngay khi load mà phải chờ scroll,
  // có thể bỏ autoplay trong HTML; nhưng để như hiện tại cũng ok.

  function playMuted() {
    const p = video.play();
    if (p && typeof p.then === "function") {
      p.catch(() => {
        // nếu browser vẫn chặn auto-play thì lúc user click sẽ play được
      });
    }
  }

  function pauseVideo() {
    if (!video.paused) video.pause();
  }

  // Auto-play khi card vào viewport
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !document.hidden) {
          playMuted();
        } else {
          pauseVideo();
        }
      });
    },
    {
      threshold: 0.4, // ≥40% card xuất hiện thì play
    }
  );

  observer.observe(card);

  // Dừng khi tab browser bị ẩn
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      pauseVideo();
    } else {
      // tab quay lại → nếu card đang trong viewport thì play lại
      const rect = card.getBoundingClientRect();
      const inView =
        rect.top < window.innerHeight * 0.9 && rect.bottom > window.innerHeight * 0.1;
      if (inView) playMuted();
    }
  });

  // Click nút play: ép play + toggle mute
  if (playBtn) {
    playBtn.addEventListener("click", function (e) {
      e.stopPropagation(); // để click không bị bubbling lên card 2 lần
      playMuted();
      video.muted = !video.muted;
      playBtn.classList.toggle("is-unmuted", !video.muted);
    });
  }

  // Click bất cứ đâu trong card lần đầu cũng ép play (nếu bị chặn)
  card.addEventListener("click", function () {
    playMuted();
  }, { once: true });

  // Nếu lúc load trang card đã ở trong viewport, thử play luôn
  playMuted();
});

(function () {
  const screen = document.getElementById("screen-forum");
  if (!screen) return;

  const moreBtn = screen.querySelector('[data-forum-scroll="more-posts"]');
  const target = document.getElementById("forum-resources");
  if (!moreBtn || !target) return;

  moreBtn.addEventListener("click", function (e) {
    e.preventDefault();

    // trừ bớt chiều cao header cho đỡ bị che
    const offset = 100;
    const targetY =
      target.getBoundingClientRect().top + window.scrollY - offset;

    // nếu có Lenis thì dùng cho mượt, không thì dùng scrollTo native
    const lenis = window.__lenis || window.lenis;

    if (lenis && typeof lenis.scrollTo === "function") {
      lenis.scrollTo(targetY, {
        duration: 1.1,
        easing: (t) => 1 - Math.pow(1 - t, 3), // easeOutCubic nhẹ
      });
    } else {
      window.scrollTo({
        top: targetY,
        behavior: "smooth",
      });
    }
  });
})();

