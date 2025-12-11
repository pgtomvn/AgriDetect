// effects/menu.js
(function () {
  'use strict';

  function initNav() {
    const navInner = document.querySelector('.top-nav-inner');
    if (!navInner) return;

    const links = Array.from(navInner.querySelectorAll('.nav-link-btn'));
    const indicator = navInner.querySelector('.nav-indicator');
    if (!links.length || !indicator) return;

    // Mặc định chọn tab chẩn đoán
    let active = links.find(btn => btn.dataset.nav === 'diagnosis') || links[0];

    function moveIndicator(target, animate) {
      if (!target) return;
      const parent = target.closest('.nav-links');
      if (!parent) return;

      const rect = target.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();

      const full = rect.width;
      const width = Math.max(full * 1.1, 32); // gạch ngắn hơn 1 chút
      const x = rect.left - parentRect.left + full / 2 - width / 2;

      if (!animate) {
        indicator.classList.add('no-anim');
      } else {
        indicator.classList.remove('no-anim');
      }

      indicator.style.width = width + 'px';
      indicator.style.transform = 'translateX(' + x + 'px)';
    }

    function setActive(target) {
      if (!target) return;
      active = target;

      links.forEach(btn => {
        const is = btn === target;
        btn.classList.toggle('is-active', is);
        btn.setAttribute('aria-pressed', is ? 'true' : 'false');
      });

      moveIndicator(target, true);

      // event để sau này bạn dùng đổi panel
      window.dispatchEvent(
        new CustomEvent('agri-nav-select', {
          detail: { target: target.dataset.nav || '' }
        })
      );
    }

    // Setup các nút
    links.forEach(btn => {
      const isDefault = btn === active;
      btn.setAttribute('role', 'button');
      btn.setAttribute('tabindex', '0');
      btn.setAttribute('aria-pressed', isDefault ? 'true' : 'false');
      if (isDefault) btn.classList.add('is-active');

      btn.addEventListener('click', () => setActive(btn));

      btn.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          btn.click();
        }
      });
    });

    // Đặt vị trí ban đầu cho indicator (không animate)
    function layout() {
      moveIndicator(active, false);
    }

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(layout).catch(layout);
    } else {
      layout();
    }

    window.addEventListener('resize', layout);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNav);
  } else {
    initNav();
  }
})();
