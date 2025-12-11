// effects/tools.js

(function(){
  "use strict";

  // ============================================================
  // 1. DỮ LIỆU CẤU HÌNH (Mô phỏng file fert_profiles.json)
  // ============================================================
  const FERT_DATA = {
      "crops": {
        "tomato": {
          "name": "Cà chua",
          "n_kg_ha": 125, "p2o5_kg_ha": 200, "k2o_kg_ha": 240,
          "seeds_per_gram": 300, // Khoảng 300 hạt/gam
          "density_row": 0.7,    // Hàng cách hàng chuẩn (m)
          "density_tree": 0.4,   // Cây cách cây chuẩn (m)
          "stages": { /* giữ nguyên như cũ */
            "full":     { "label": "Cả vụ / Tổng nhu cầu", "fraction": 1.0 },
            "basal":    { "label": "Bón lót (Trước trồng)", "fraction": 0.4 },
            "topdress": { "label": "Bón thúc (Nuôi quả)", "fraction": 0.6 }
          },
          "note": "Cà chua thường trồng hàng đôi, mật độ khoảng 25-30 ngàn cây/ha."
        },
        "potato": {
          "name": "Khoai tây",
          "n_kg_ha": 200, "p2o5_kg_ha": 70, "k2o_kg_ha": 300,
          "seeds_per_gram": 0,   // Khoai tây tính củ giống (kg), xử lý riêng sau
          "density_row": 0.6,
          "density_tree": 0.3,
          "stages": { /* giữ nguyên */ 
              "full":     { "label": "Cả vụ / Tổng nhu cầu", "fraction": 1.0 },
              "basal":    { "label": "Bón lót", "fraction": 0.66 },
              "topdress": { "label": "Bón thúc", "fraction": 0.34 }
          },
          "note": "Khoai tây trồng bằng củ, lượng giống tính theo tấn/ha (không tính hạt)."
        },
        "bell_pepper": {
          "name": "Ớt chuông",
          "n_kg_ha": 180, "p2o5_kg_ha": 100, "k2o_kg_ha": 240,
          "seeds_per_gram": 150, // Hạt ớt lớn hơn cà chua
          "density_row": 1.2,    // Luống đôi thường rộng
          "density_tree": 0.4,
          "stages": { /* giữ nguyên */ 
              "full":     { "label": "Cả vụ / Tổng nhu cầu", "fraction": 1.0 },
              "basal":    { "label": "Bón lót", "fraction": 0.3 },
              "topdress": { "label": "Bón thúc", "fraction": 0.7 }
          },
          "note": "Ớt chuông thường trồng luống đôi, cần không gian thoáng để tránh nấm bệnh."
        }
      },
      "products": { /* Giữ nguyên phần phân bón */
        "ure":       { "name": "Đạm Ure (46% N)",        "N": 46, "P2O5": 0,  "K2O": 0,  "basis": "N" },
        "sa":        { "name": "Đạm SA (21% N)",         "N": 21, "P2O5": 0,  "K2O": 0,  "basis": "N" },
        "dap":       { "name": "DAP 18-46-0",            "N": 18, "P2O5": 46, "K2O": 0,  "basis": "P2O5" },
        "kali":      { "name": "Kali Clorua (60% K2O)",  "N": 0,  "P2O5": 0,  "K2O": 60, "basis": "K2O" },
        "npk16168":  { "name": "NPK 16-16-8",            "N": 16, "P2O5": 16, "K2O": 8,  "basis": "N" },
        "npk151515": { "name": "NPK 15-15-15",           "N": 15, "P2O5": 15, "K2O": 15, "basis": "N" },
        "npk202015": { "name": "NPK 20-20-15",           "N": 20, "P2O5": 20, "K2O": 15, "basis": "N" },
        "huuco":     { "name": "Phân hữu cơ (QC 2-2-2)", "N": 2,  "P2O5": 2,  "K2O": 2,  "basis": "N" }
      }
    };
  // ============================================================
  // 2. CÁC HÀM TIỆN ÍCH CHUNG (HELPER)
  // ============================================================
  
  // Đổi các đơn vị diện tích về Hecta (ha)
  function areaToHa(val, unit){
    const v = parseFloat(val || '0');
    if (!v || v <= 0) return 0;
    switch(unit){
      case 'ha':      return v;
      case 'sao-bac': return v * 360 / 10000;  // 1 sào bắc = 360m2
      case 'sao-nam': return v * 1000 / 10000; // 1 sào nam = 1000m2
      case 'm2':      return v / 10000;
      default:        return v;
    }
  }

  // Format số đẹp (VD: 1,200.5)
  function fmt(num) {
    if (isNaN(num)) return "0";
    // Làm tròn 1 chữ số thập phân nếu cần
    return Math.round(num * 10) / 10;
  }
  
  function fmtLocale(num) {
    return fmt(num).toLocaleString('vi-VN');
  }

  // ============================================================
  // 3. LOGIC CHUYỂN TAB CÔNG CỤ
  // ============================================================
  (function initTabs(){
    const toolBtns = Array.from(document.querySelectorAll('.tool-nav-btn'));
    const panels   = Array.from(document.querySelectorAll('.tool-panel-inner'));

    function showTool(name){
      // Active nút bấm
      toolBtns.forEach(btn => {
        const isActive = btn.dataset.tool === name;
        btn.classList.toggle('is-active', isActive);
      });

      // Active panel nội dung (với hiệu ứng fade)
      panels.forEach(panel => {
        const isActive = panel.dataset.toolPanel === name;
        if (isActive){
          panel.style.display = '';
          // Timeout nhỏ để trình duyệt nhận diện display:block trước khi add class animation
          requestAnimationFrame(() => {
            panel.classList.add('is-active-panel');
          });
        } else {
          panel.classList.remove('is-active-panel');
          panel.style.display = 'none';
        }
      });
    }

    if (toolBtns.length > 0) {
      toolBtns.forEach(btn => {
        btn.addEventListener('click', () => showTool(btn.dataset.tool));
      });
      // Mặc định mở tool đầu tiên (fert)
      showTool('fert');
    }
  })();


  // ============================================================
  // 4. TOOL 1: TÍNH LƯỢNG PHÂN BÓN (NÂNG CẤP)
  // ============================================================
  (function initFertTool(){
    const dom = {
      area:    document.getElementById('area-value'),
      unit:    document.getElementById('area-unit'),
      crop:    document.getElementById('crop-select'),
      stage:   document.getElementById('stage-select'),
      product: document.getElementById('fert-product'),
      target:  document.getElementById('nutrient-target'),
      hint:    document.getElementById('nutrient-hint'),
      basisInfo: document.getElementById('calc-basis-info'),
      basisName: document.getElementById('basis-name'),
      note:    document.getElementById('crop-note'),
      btnCalc: document.getElementById('btnCalcFert'),
      btnReset:document.getElementById('btnResetFert'),
      result:  document.getElementById('fertResult'),
      resKg:   document.getElementById('fertKg'),
      resUnit: document.getElementById('fertUnitLabel'),
      resDetail: document.getElementById('fertDetail')
    };

    if (!dom.btnCalc) return; // Nếu không tìm thấy element thì thoát

    // --- A. Đổ dữ liệu vào Dropdown ---
    // 1. Crops
    Object.keys(FERT_DATA.crops).forEach(key => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = FERT_DATA.crops[key].name;
      dom.crop.appendChild(opt);
    });

    // 2. Products
    Object.keys(FERT_DATA.products).forEach(key => {
      const p = FERT_DATA.products[key];
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = p.name;
      dom.product.appendChild(opt);
    });

    // --- B. Hàm xử lý logic gợi ý ---
    function updateSuggestion() {
      const cropKey  = dom.crop.value;
      const stageKey = dom.stage.value;
      const prodKey  = dom.product.value;
      
      // 1. Xác định "Chất cơ sở" (Basis)
      // Nếu chưa chọn phân, mặc định là N. Nếu chọn rồi thì lấy theo phân.
      let basis = 'N'; 
      if (prodKey && FERT_DATA.products[prodKey]) {
        basis = FERT_DATA.products[prodKey].basis;
      }

      // Hiển thị info đang tính theo chất nào
      if (prodKey) {
        dom.basisInfo.style.display = 'block';
        dom.basisName.textContent = basis === 'P2O5' ? 'Lân (P2O5)' : (basis === 'K2O' ? 'Kali (K2O)' : 'Đạm (N)');
      } else {
        dom.basisInfo.style.display = 'none';
      }

      // 2. Lấy định mức từ Crop Data
      if (cropKey && FERT_DATA.crops[cropKey]) {
        const cropData = FERT_DATA.crops[cropKey];
        
        // Hiện Note
        dom.note.style.display = 'block';
        dom.note.textContent = "💡 " + cropData.note;

        // Lấy tỷ lệ giai đoạn (fraction)
        let fraction = 1.0;
        if (stageKey && cropData.stages[stageKey]) {
          fraction = cropData.stages[stageKey].fraction;
        }

        // Lấy giá trị dinh dưỡng chuẩn (kg/ha)
        let standardVal = 0;
        if (basis === 'N') standardVal = cropData.n_kg_ha;
        else if (basis === 'P2O5') standardVal = cropData.p2o5_kg_ha;
        else if (basis === 'K2O') standardVal = cropData.k2o_kg_ha;

        const finalSuggest = Math.round(standardVal * fraction);

        // Auto fill vào input
        dom.target.value = finalSuggest;
        
        // Hiệu ứng nháy nhẹ để báo hiệu đã thay đổi
        dom.target.classList.remove('auto-filled');
        void dom.target.offsetWidth; // trigger reflow
        dom.target.classList.add('auto-filled');

        // Text gợi ý bên dưới input
        let basisLabel = basis === 'N' ? "Đạm (N)" : (basis === 'P2O5' ? "Lân (P2O5)" : "Kali (K2O)");
        dom.hint.textContent = `Gợi ý: ${cropData.name} cần khoảng ${finalSuggest} kg ${basisLabel}/ha cho giai đoạn này.`;
      
      } else {
        dom.note.style.display = 'none';
        dom.hint.textContent = '';
      }
    }

    // --- C. Event Listeners ---
    
    // 1. Khi đổi Cây -> Cập nhật danh sách Giai đoạn
    dom.crop.addEventListener('change', () => {
      const cropKey = dom.crop.value;
      dom.stage.innerHTML = ''; // Xóa cũ
      
      if (cropKey && FERT_DATA.crops[cropKey]) {
        const stages = FERT_DATA.crops[cropKey].stages;
        Object.keys(stages).forEach(sKey => {
          const sData = stages[sKey];
          const opt = document.createElement('option');
          opt.value = sKey;
          // Hiển thị Label + %
          opt.textContent = `${sData.label} (${Math.round(sData.fraction * 100)}%)`;
          dom.stage.appendChild(opt);
        });
        dom.stage.disabled = false;
        // Tự động chọn option đầu tiên và update
        dom.stage.value = Object.keys(stages)[0];
      } else {
        const opt = document.createElement('option');
        opt.textContent = "Chọn cây trước...";
        dom.stage.appendChild(opt);
        dom.stage.disabled = true;
      }
      updateSuggestion();
    });

    // 2. Khi đổi Giai đoạn hoặc Loại phân -> Cập nhật gợi ý
    dom.stage.addEventListener('change', updateSuggestion);
    dom.product.addEventListener('change', updateSuggestion);

    // 3. Nút Tính toán
    dom.btnCalc.addEventListener('click', () => {
      const area = parseFloat(dom.area.value || 0);
      const target = parseFloat(dom.target.value || 0);
      const prodKey = dom.product.value;

      if (area <= 0) {
        alert("Vui lòng nhập diện tích > 0");
        return;
      }
      if (target <= 0) {
        alert("Vui lòng nhập nhu cầu dinh dưỡng > 0 (hoặc chọn cây để gợi ý)");
        return;
      }
      if (!prodKey) {
        alert("Vui lòng chọn loại phân bón muốn tính.");
        return;
      }

      // -- BẮT ĐẦU TÍNH --
      const ha = areaToHa(area, dom.unit.value);
      const prodInfo = FERT_DATA.products[prodKey];
      const basis = prodInfo.basis || 'N';
      const percent = prodInfo[basis]; // Hàm lượng % của chất cơ sở

      if (percent <= 0) {
        alert(`Loại phân này không chứa ${basis}, vui lòng chọn loại khác.`);
        return;
      }

      // Công thức: Tổng phân = (Mục tiêu kg/ha * Diện tích ha * 100) / %Hàm lượng
      const totalFertKg = (target * ha * 100) / percent;

      // Tính các chất đi kèm (Side Nutrients)
      // Ví dụ: Bón NPK để lấy N, thì P và K cung cấp thêm là bao nhiêu?
      let detailHtml = `Để đạt <b>${fmtLocale(target * ha)} kg ${basis}</b> trên diện tích này.<br/>`;
      detailHtml += `<span style="display:block;margin-top:4px;font-style:italic">Dinh dưỡng đi kèm:</span>`;
      
      let hasSide = false;
      ['N', 'P2O5', 'K2O'].forEach(nut => {
        if (nut !== basis && prodInfo[nut] > 0) {
          const supplied = (totalFertKg * prodInfo[nut]) / 100;
          detailHtml += `+ <b>${fmtLocale(supplied)} kg ${nut}</b><br/>`;
          hasSide = true;
        }
      });
      if (!hasSide) detailHtml += `(Không có dưỡng chất đa lượng khác)`;

      // Render kết quả
      dom.resKg.textContent = fmtLocale(totalFertKg);
      dom.resUnit.textContent = `kg ${prodInfo.name}`;
      dom.resDetail.innerHTML = detailHtml;
      
      dom.result.style.display = 'flex';
    });

    // 4. Nút Reset
    dom.btnReset.addEventListener('click', () => {
      dom.area.value = '';
      dom.target.value = '';
      dom.crop.value = '';
      // Reset stage
      dom.stage.innerHTML = '<option>Chọn cây trước...</option>';
      dom.stage.disabled = true;
      dom.product.value = '';
      
      // Ẩn UI kết quả
      dom.result.style.display = 'none';
      dom.note.style.display = 'none';
      dom.basisInfo.style.display = 'none';
      dom.hint.textContent = '';
    });
  })();


  // ============================================================
  // 5. TOOL 2: PHA THUỐC & DUNG DỊCH
  // ============================================================
(function initSprayTool(){
    const dom = {
      mode:      document.getElementById('spray-mode'),
      tankType:  document.getElementById('tank-type'),
      tankVol:   document.getElementById('tank-volume'),
      tankCount: document.getElementById('tank-count'),
      
      // Mode Basic
      divBasic:  document.getElementById('input-mode-basic'),
      doseAmt:   document.getElementById('dose-amount'),
      doseUnit:  document.getElementById('dose-unit'),
      
      // Mode Rate
      divRate:   document.getElementById('input-mode-rate'),
      rateDose:  document.getElementById('rate-dose'),
      rateWater: document.getElementById('rate-water'),

      btnCalc:   document.getElementById('btnCalcSpray'),
      btnReset:  document.getElementById('btnResetSpray'),
      result:    document.getElementById('sprayResult'),
      resWater:  document.getElementById('sprayWater'),
      resPest:   document.getElementById('sprayPesticide'),
      resUnit:   document.getElementById('sprayPesticideUnit'),
      resGuide:  document.getElementById('sprayGuide')
    };

    if (!dom.btnCalc) return;

    // 1. Xử lý hiển thị input theo Mode
    function updateUI() {
      if (dom.mode.value === 'basic') {
        dom.divBasic.style.display = 'block';
        dom.divRate.style.display = 'none';
      } else {
        dom.divBasic.style.display = 'none';
        dom.divRate.style.display = 'block';
      }
      
      // Xử lý custom tank
      if (dom.tankType.value === 'custom') {
        dom.tankVol.style.display = 'block';
      } else {
        dom.tankVol.style.display = 'none';
        dom.tankVol.value = dom.tankType.value;
      }
    }

    dom.mode.addEventListener('change', updateUI);
    dom.tankType.addEventListener('change', updateUI);
    updateUI(); // init

    // 2. Tính toán
    dom.btnCalc.addEventListener('click', () => {
      const volPerTank = parseFloat(dom.tankVol.value || 0);
      const count      = parseFloat(dom.tankCount.value || 0);

      if (volPerTank <= 0 || count <= 0) {
        alert("Vui lòng nhập thể tích và số lượng bình hợp lệ.");
        return;
      }

      let dosePerTank = 0; // Luôn quy về lượng thuốc cho 1 bình
      let unit = 'ml';

      if (dom.mode.value === 'basic') {
        dosePerTank = parseFloat(dom.doseAmt.value || 0);
        unit = dom.doseUnit.value;
      } else {
        // Quy đổi tỷ lệ
        const rDose  = parseFloat(dom.rateDose.value || 0);
        const rWater = parseFloat(dom.rateWater.value || 0);
        if (rDose <= 0 || rWater <= 0) {
          alert("Vui lòng nhập tỷ lệ pha (VD: 20ml cho 16L).");
          return;
        }
        // Công thức tam suất: (VolTank * rDose) / rWater
        dosePerTank = (volPerTank * rDose) / rWater;
        // Mặc định unit theo input (người dùng tự hiểu số liệu họ nhập)
        unit = 'ml (g)'; 
      }

      if (dosePerTank <= 0) {
        alert("Vui lòng nhập liều lượng thuốc.");
        return;
      }

      // Tổng kết
      const totalWater = volPerTank * count;
      const totalPest  = dosePerTank * count;

      // Render
      dom.resWater.textContent = fmtLocale(totalWater);
      dom.resPest.textContent  = fmtLocale(totalPest);
      dom.resUnit.textContent  = unit;

      // Hướng dẫn pha (Step-by-step text)
      dom.resGuide.innerHTML = `
        <strong>📋 Hướng dẫn thực hiện:</strong><br/>
        - Bạn cần chuẩn bị tổng cộng <b>${count}</b> lần pha (cho ${count} bình ${volPerTank}L).<br/>
        - Mỗi bình: Đổ khoảng 1/3 nước sạch vào bình, hòa tan <b>${fmtLocale(dosePerTank)} ${unit}</b> thuốc, khuấy đều, sau đó đổ đầy nước đủ ${volPerTank}L.
      `;

      dom.result.style.display = 'flex';
    });

    dom.btnReset.addEventListener('click', () => {
      dom.tankCount.value = '1';
      dom.doseAmt.value = '';
      dom.rateDose.value = '';
      dom.rateWater.value = '';
      dom.result.style.display = 'none';
    });
  })();

  // ============================================================
  // 6. TOOL 3: MẬT ĐỘ & HẠT GIỐNG (PRO VERSION)
  // ============================================================
  (function initDensityTool(){
    const dom = {
      crop:       document.getElementById('density-crop-select'),
      area:       document.getElementById('area-density'),
      unit:       document.getElementById('area-unit-density'),
      pattern:    document.getElementById('plant-pattern'),
      rowSpace:   document.getElementById('row-spacing'),
      treeSpace:  document.getElementById('plant-spacing'),
      germRate:   document.getElementById('germination-rate'),
      extraRate:  document.getElementById('extra-rate'),
      btnCalc:    document.getElementById('btnCalcDensity'),
      btnReset:   document.getElementById('btnResetDensity'),
      result:     document.getElementById('densityResult'),
      resFinal:   document.getElementById('densityFinal'),
      resSeed:    document.getElementById('seedResult')
    };

    if (!dom.btnCalc) return;

    // Fill crop list
    Object.keys(FERT_DATA.crops).forEach(key => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = FERT_DATA.crops[key].name;
        dom.crop.appendChild(opt);
    });

    // Auto fill spacing khi chọn cây
    dom.crop.addEventListener('change', () => {
        const key = dom.crop.value;
        if (key && FERT_DATA.crops[key]) {
            dom.rowSpace.value = FERT_DATA.crops[key].density_row;
            dom.treeSpace.value = FERT_DATA.crops[key].density_tree;
        }
    });

    dom.btnCalc.addEventListener('click', () => {
      const areaVal = parseFloat(dom.area.value || 0);
      const row     = parseFloat(dom.rowSpace.value || 0);
      const tree    = parseFloat(dom.treeSpace.value || 0);
      
      if (areaVal <= 0 || row <= 0 || tree <= 0) {
        alert("Vui lòng nhập diện tích và khoảng cách hợp lệ.");
        return;
      }

      const ha = areaToHa(areaVal, dom.unit.value);
      const m2 = ha * 10000;
      
      // Công thức Mật độ
      // Hàng đơn: Cây = Diện tích / (Hàng * Cây)
      // Hàng đôi: Cây = Diện tích / (Hàng * Cây) * 2 (Giả sử Hàng ở đây là khoảng cách tim luống đôi)
      // Tuy nhiên, để đơn giản cho user, ta quy ước:
      // "Khoảng cách hàng" là khoảng cách giữa các tim luống (luống đơn hoặc luống đôi).
      // Nếu chọn Hàng đôi, số cây trên 1 mét dài luống sẽ gấp đôi.
      
      let plants = (m2 / (row * tree));
      if (dom.pattern.value === 'double') {
          plants = plants * 2;
      }

      plants = Math.round(plants);

      // Tính hạt giống
      const germ = parseFloat(dom.germRate.value || 100);
      const extra = parseFloat(dom.extraRate.value || 0);
      
      // Số cây cần chuẩn bị (gồm dự phòng)
      const plantsNeeded = plants * (1 + extra/100);
      // Số hạt cần gieo (gồm bù nảy mầm)
      const seedsNeeded = plantsNeeded / (germ/100);

      dom.resFinal.textContent = plants.toLocaleString('vi-VN');

      // Nếu crop có dữ liệu hạt/gam -> tính ra gam
      const cropKey = dom.crop.value;
      if (cropKey && FERT_DATA.crops[cropKey] && FERT_DATA.crops[cropKey].seeds_per_gram > 0) {
         const seedsPerGram = FERT_DATA.crops[cropKey].seeds_per_gram;
         const grams = seedsNeeded / seedsPerGram;
         dom.resSeed.style.display = 'block';
         dom.resSeed.innerHTML = `
            <b>📦 Dự trù hạt giống:</b><br/>
            Cần khoảng <b>${Math.ceil(seedsNeeded).toLocaleString()} hạt</b> (tương đương <b>${fmtLocale(grams)} gam</b>)<br/>
            <small>(Đã bao gồm ${100-germ}% không nảy mầm và ${extra}% dự phòng dặm)</small>
         `;
      } else {
         dom.resSeed.style.display = 'none';
      }

      dom.result.style.display = 'flex';
    });

    dom.btnReset.addEventListener('click', () => {
        dom.area.value = '';
        dom.crop.value = '';
        dom.result.style.display = 'none';
    });
  })();

  // ============================================================
  // 7. TOOL 4: DOANH THU & SẢN LƯỢNG (PRO VERSION)
  // ============================================================
  (function initYieldTool(){
    const dom = {
      mode:      document.getElementById('yield-mode'),
      grpArea:   document.getElementById('yield-area-group'),
      grpPlant:  document.getElementById('yield-plant-group'),
      inputArea: document.getElementById('yield-area'),
      unitArea:  document.getElementById('yield-area-unit'),
      perHa:     document.getElementById('yield-per-ha'),
      inputPlant:document.getElementById('yield-plant-count'),
      perPlant:  document.getElementById('yield-per-plant'),
      
      loss:      document.getElementById('loss-rate'),
      rate1:     document.getElementById('rate-type1'),
      price1:    document.getElementById('price-type1'),
      price2:    document.getElementById('price-type2'),
      
      btnCalc:   document.getElementById('btnCalcYield'),
      btnReset:  document.getElementById('btnResetYield'),
      result:    document.getElementById('yieldResult'),
      resNetKg:  document.getElementById('yieldNetKg'),
      resRev:    document.getElementById('yieldRevenue'),
      resBreak:  document.getElementById('yieldBreakdown')
    };

    if (!dom.btnCalc) return;

    function syncMode() {
        if (dom.mode.value === 'area') {
            dom.grpArea.style.display = 'block';
            dom.grpPlant.style.display = 'none';
        } else {
            dom.grpArea.style.display = 'none';
            dom.grpPlant.style.display = 'block';
        }
        dom.result.style.display = 'none';
    }
    dom.mode.addEventListener('change', syncMode);
    syncMode(); // init

    dom.btnCalc.addEventListener('click', () => {
        let grossKg = 0;

        // 1. Tính tổng sản lượng thô
        if (dom.mode.value === 'area') {
            const area = parseFloat(dom.inputArea.value || 0);
            const yHa  = parseFloat(dom.perHa.value || 0);
            if (area <= 0 || yHa <= 0) {alert("Nhập diện tích & năng suất > 0"); return;}
            grossKg = areaToHa(area, dom.unitArea.value) * yHa * 1000;
        } else {
            const count = parseFloat(dom.inputPlant.value || 0);
            const yTree = parseFloat(dom.perPlant.value || 0);
            if (count <= 0 || yTree <= 0) {alert("Nhập số cây & năng suất > 0"); return;}
            grossKg = count * yTree;
        }

        // 2. Trừ hao hụt
        const lossRate = parseFloat(dom.loss.value || 0);
        const netKg = grossKg * (1 - lossRate/100);

        // 3. Tính tiền theo phân loại
        const type1Rate = parseFloat(dom.rate1.value || 70); // % hàng loại 1
        const type2Rate = 100 - type1Rate;
        
        const price1 = parseFloat(dom.price1.value || 0);
        const price2 = parseFloat(dom.price2.value || 0);

        const kg1 = netKg * (type1Rate/100);
        const kg2 = netKg * (type2Rate/100);
        
        const rev1 = kg1 * price1;
        const rev2 = kg2 * price2;
        const totalRev = rev1 + rev2;

        // Render
        dom.resNetKg.textContent = fmtLocale(netKg) + ' kg';
        dom.resRev.textContent = totalRev.toLocaleString('vi-VN') + ' đ';
        
        if (totalRev > 0) {
           dom.resBreak.innerHTML = `
             - Loại 1 (${type1Rate}%): <b>${rev1.toLocaleString()} đ</b><br/>
             - Loại 2 (${type2Rate}%): <b>${rev2.toLocaleString()} đ</b>
           `;
        } else {
           dom.resBreak.innerHTML = '(Chưa nhập giá bán)';
        }

        dom.result.style.display = 'flex';
    });

    dom.btnReset.addEventListener('click', () => {
        dom.inputArea.value = '';
        dom.perHa.value = '';
        dom.inputPlant.value = '';
        dom.price1.value = '';
        dom.price2.value = '';
        dom.result.style.display = 'none';
    });
  })();

})();