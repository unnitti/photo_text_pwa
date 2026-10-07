(() => {
  'use strict';
  // 색 순서: 흰색, 빨강, 노랑, 파랑, 초록, 분홍, 주황, 보라. 짙은 글 상자 위에서 잘 보이는 밝은 색.
  const COLORS = ['#ffffff', '#ff5e50', '#ffd84d', '#6bb5ff', '#5fd38a', '#f76cb4', '#ffa033', '#b58cff'];
  const LINE_HEIGHT = 1.25;
  const MAX_ROWS = 8, MIN_ROWS = 2;
  // 대/중/소 글씨 크기는 실제 폰트 px 값을 그대로 사용.
  const FONT_PX_LARGE = 240, FONT_PX_MEDIUM = 180, FONT_PX_SMALL = 120;
  const DEFAULT_FONT_SIZE = FONT_PX_MEDIUM; // 기본값 "중"
  // 글 상자 여백은 폰트 크기에 비례. 28px/18px 여백이 96px 폰트 기준이었던 것을 비율로 미리 계산해둔 값.
  const PAD_X_RATIO = 28 / 96, PAD_Y_RATIO = 18 / 96;
  // 글 상자 모양. 화면(CSS)과 저장 이미지(canvas)가 같은 값을 쓰도록 한곳에 모아 둠.
  const BOX_FILL = 'rgba(18, 22, 26, .60)';
  const BOX_RADIUS_RATIO = .14, SHADOW_Y_RATIO = .012, SHADOW_BLUR_RATIO = .03;
  const TEXT_SHADOW = 'rgba(0, 0, 0, .45)';
  const SNAP_SCALE = 1.02; // 이 배율 이하로 줄이면 사진 전체에 딱 맞는 상태로 돌아감
  const UNDO_MS = 6000;
  // true면 미리보기 화면 없이 iOS 공유 시트를 바로 엶(실험). 기기 확인 전까지 false.
  const SHARE_SHEET_FIRST = false;
  const photoInput = document.querySelector('#photoInput');
  const textInputs = document.querySelector('#textInputs');
  const clearTextButton = document.querySelector('#clearTextButton');
  const canvas = document.querySelector('#photoCanvas');
  const ctx = canvas.getContext('2d');
  const stageWrap = document.querySelector('#stageWrap');
  const stageArea = document.querySelector('#stageArea');
  const overlay = document.querySelector('#overlay');
  const editor = document.querySelector('#editor');
  const saveButton = document.querySelector('#saveButton');
  const photoLabelText = document.querySelector('#photoLabelText');
  const undoToast = document.querySelector('#undoToast');
  const undoText = document.querySelector('#undoText');
  const undoButton = document.querySelector('#undoButton');
  const status = document.querySelector('#status');
  let hasPhoto = false; // 원본 Image는 캔버스에 그린 뒤 보관하지 않음(메모리 절약)
  let captions = [];
  let drag = null;
  let lastPreviewUrl = null;
  let undoTimer = null, undoAction = null;

  // 문장별로 따로 관리하는 텍스트/글씨크기/색상. 마지막 줄에 글을 쓰면 줄이 하나씩 자동으로 늘어남.
  let visibleCount = MIN_ROWS;
  const rowValues = new Array(MAX_ROWS).fill('');
  rowValues[0] = '수정 전후';
  const rowFontSizes = new Array(MAX_ROWS).fill(DEFAULT_FONT_SIZE); // 기본값 "중"
  // 각 줄의 색상은 COLORS 배열의 인덱스. 글을 처음 쓰는 줄에는 아직 쓰이지 않은 첫 색을 자동으로 주고(rowColorAuto),
  // 색 버튼을 직접 누른 줄은 자동 배정을 멈춤. 버튼은 8색을 건너뜀 없이 순서대로 순환.
  const rowColorIndex = COLORS.map((_, i) => i);
  const rowColorAuto = new Array(MAX_ROWS).fill(true);

  // 두 손가락 확대/이동 상태 (stageWrap 전체에 CSS transform으로 적용)
  let view = { scale: 1, offsetX: 0, offsetY: 0 };
  const MIN_SCALE = 1, MAX_SCALE = 6;
  const activePointers = new Map();
  let zoomGesture = null;

  function say(message) { status.textContent = message; }
  function padX(fontPx) { return fontPx * PAD_X_RATIO; }
  function padY(fontPx) { return fontPx * PAD_Y_RATIO; }
  function fontSizeLabel(fontPx) { return fontPx === FONT_PX_LARGE ? '대' : fontPx === FONT_PX_SMALL ? '소' : '중'; }
  // 순환 순서: 대 -> 소 -> 중 -> (다시 대)
  function nextFontSize(fontPx) { return fontPx === FONT_PX_LARGE ? FONT_PX_SMALL : fontPx === FONT_PX_SMALL ? FONT_PX_MEDIUM : FONT_PX_LARGE; }

  function isFilled(i) { return String(rowValues[i] || '').trim() !== ''; }
  function filledCount() { let n = 0; for (let i = 0; i < MAX_ROWS; i++) if (isFilled(i)) n++; return n; }
  // 아직 다른 글이 쓰지 않는 색 중 가장 앞선 색. 모두 쓰였으면 줄 번호에 맞는 색.
  function pickAutoColor(i) {
    const used = new Set();
    for (let k = 0; k < MAX_ROWS; k++) if (k !== i && isFilled(k)) used.add(rowColorIndex[k]);
    for (let c = 0; c < COLORS.length; c++) if (!used.has(c)) return c;
    return i % COLORS.length;
  }
  let chips = [];
  function refreshChips() {
    chips.forEach((chip, i) => {
      chip.style.background = COLORS[rowColorIndex[i]];
      // 글이 있는 다른 줄과 색이 같으면 표시(저장 전에 실수로 겹치지 않게)
      let dup = false;
      if (isFilled(i)) for (let k = 0; k < MAX_ROWS; k++) if (k !== i && isFilled(k) && rowColorIndex[k] === rowColorIndex[i]) dup = true;
      chip.classList.toggle('dup', dup);
    });
  }
  function takeSnapshot() {
    return { visibleCount, values: rowValues.slice(), sizes: rowFontSizes.slice(), colors: rowColorIndex.slice(), auto: rowColorAuto.slice(),
      pos: captions.map(c => ({ index: c.index, x: c.x, y: c.y })) };
  }
  function restoreSnapshot(s) {
    visibleCount = s.visibleCount;
    for (let i = 0; i < MAX_ROWS; i++) { rowValues[i] = s.values[i]; rowFontSizes[i] = s.sizes[i]; rowColorIndex[i] = s.colors[i]; rowColorAuto[i] = s.auto[i]; }
    makeTextInputs();
    captions.forEach(c => { const p = s.pos.find(q => q.index === c.index); if (p) { c.x = p.x; c.y = p.y; } });
    layoutCaptions();
  }
  function hideUndo() { undoToast.hidden = true; undoAction = null; clearTimeout(undoTimer); }
  function showUndo(message, action) {
    undoAction = action; undoText.textContent = message; undoToast.hidden = false;
    clearTimeout(undoTimer); undoTimer = setTimeout(hideUndo, UNDO_MS);
  }
  function createRow(i) {
    const row = document.createElement('div'); row.className = 'text-row';
    const colorBtn = document.createElement('button'); colorBtn.type = 'button'; colorBtn.className = 'color-dot';
    colorBtn.setAttribute('aria-label', `${i + 1}번째 글 색상 변경`); chips[i] = colorBtn;
    colorBtn.addEventListener('click', () => {
      rowColorAuto[i] = false;
      rowColorIndex[i] = (rowColorIndex[i] + 1) % COLORS.length;
      refreshChips(); rebuildCaptions();
    });
    const wrap = document.createElement('div'); wrap.className = 'input-wrap';
    const input = document.createElement('input'); input.type = 'text'; input.placeholder = `글 ${i + 1}`; input.value = rowValues[i] || '';
    const clearBtn = document.createElement('button'); clearBtn.type = 'button'; clearBtn.className = 'clear-x'; clearBtn.textContent = '×';
    clearBtn.setAttribute('aria-label', `${i + 1}번째 글 지우기`); clearBtn.hidden = !input.value;
    input.addEventListener('input', () => {
      const wasFilled = isFilled(i);
      rowValues[i] = input.value; clearBtn.hidden = !input.value;
      const nowFilled = isFilled(i);
      if (!wasFilled && nowFilled && rowColorAuto[i]) rowColorIndex[i] = pickAutoColor(i);
      // 맨 아래 줄에 글을 쓰면 빈 줄이 하나 더 생김(최대 MAX_ROWS줄)
      if (nowFilled && i === visibleCount - 1 && visibleCount < MAX_ROWS) { visibleCount++; textInputs.appendChild(createRow(visibleCount - 1)); }
      refreshChips(); rebuildCaptions();
    });
    input.addEventListener('blur', () => {
      // 입력 중엔 그대로 두고, 칸을 벗어날 때 안의 숫자 덩어리(연속된 숫자)를 하나씩 검사.
      // 그 덩어리가 정확히 6자리일 때만 "26.09.12" 형식으로 변환. 5자리 이하나 7자리 이상으로
      // 이어진 숫자 덩어리, 영문/기호는 그대로 둠. "260912~260913"처럼 구분자로 섞어 써도
      // 각 6자리 덩어리가 따로따로 변환됨.
      const value = input.value;
      const formatted = value.replace(/\d+/g, (run) => (
        run.length === 6 ? `${run.slice(0, 2)}.${run.slice(2, 4)}.${run.slice(4, 6)}` : run
      ));
      if (formatted !== value) { input.value = formatted; rowValues[i] = formatted; rebuildCaptions(); }
    });
    clearBtn.addEventListener('click', () => {
      // 이 줄의 글 내용, 글씨 크기, 색상을 처음 상태로. 줄 자체는 없애지 않음(빈 줄은 사진에 안 나옴).
      const snapshot = takeSnapshot();
      rowValues[i] = ''; input.value = ''; clearBtn.hidden = true;
      rowFontSizes[i] = DEFAULT_FONT_SIZE; rowColorIndex[i] = i; rowColorAuto[i] = true;
      sizeBtnPaint();
      refreshChips(); rebuildCaptions();
      showUndo('1줄을 지웠어요', () => restoreSnapshot(snapshot));
    });
    wrap.appendChild(input); wrap.appendChild(clearBtn);
    const sizeBtn = document.createElement('button'); sizeBtn.type = 'button'; sizeBtn.className = 'size-cycle-button';
    const glyph = document.createElement('span'); glyph.className = 'size-glyph'; glyph.textContent = '가'; sizeBtn.appendChild(glyph);
    // 칸은 고정이고 "가"만 단계별로 커짐(실제 글씨 크기 비율이 아니라 순서를 보여 주는 표시).
    function sizeBtnPaint() {
      const px = rowFontSizes[i];
      glyph.style.fontSize = px === FONT_PX_LARGE ? '19px' : px === FONT_PX_SMALL ? '11px' : '15px';
      sizeBtn.setAttribute('aria-label', `${i + 1}번째 글 크기 변경 (현재 ${fontSizeLabel(px)})`);
    }
    sizeBtnPaint();
    sizeBtn.addEventListener('click', () => { rowFontSizes[i] = nextFontSize(rowFontSizes[i]); sizeBtnPaint(); rebuildCaptions(); });
    // appendChild is supported by older iPhone Safari too.
    row.appendChild(colorBtn); row.appendChild(wrap); row.appendChild(sizeBtn);
    return row;
  }
  function makeTextInputs() {
    // innerHTML is used here for compatibility with older iPhone Safari versions.
    textInputs.innerHTML = ''; chips = [];
    for (let i = 0; i < visibleCount; i++) textInputs.appendChild(createRow(i));
    refreshChips();
    rebuildCaptions();
  }
  function fillRoundRect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.fill();
  }
  function getLines(text, maxWidth, fontPx) {
    ctx.font = `700 ${fontPx}px -apple-system, BlinkMacSystemFont, sans-serif`;
    const lines = [];
    for (const paragraph of String(text).split('\n')) {
      let line = '';
      for (const ch of paragraph || ' ') {
        const next = line + ch;
        if (line && ctx.measureText(next).width > maxWidth) { lines.push(line); line = ch; } else line = next;
      }
      lines.push(line);
    }
    return lines;
  }
  function renderImage(image) { ctx.drawImage(image, 0, 0, canvas.width, canvas.height); }
  function syncStageToCanvas() {
    if (!canvas.width) return;
    // The editor may have just changed from hidden to visible on Safari. Use its
    // measured rectangle and a viewport fallback so the stage can never collapse to 1px.
    const measuredWidth = stageArea.getBoundingClientRect().width;
    const maxWidth = Math.max(1, Math.floor(measuredWidth || stageArea.clientWidth || window.innerWidth - 28));
    const scale = Math.min(1, maxWidth / canvas.width);
    const width = Math.round(canvas.width * scale), height = Math.round(canvas.height * scale);
    // One explicit size is shared by the canvas and absolute overlay. No independent max-height/flex sizing.
    stageWrap.style.width = `${width}px`; stageWrap.style.height = `${height}px`;
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    layoutCaptions();
  }
  function rebuildCaptions() {
    if (!canvas.width) return;
    const prior = new Map(captions.map(c => [c.index, c]));
    const next = [];
    for (let i = 0; i < visibleCount; i++) {
      const text = (rowValues[i] || '').trim();
      if (!text) continue;
      const previous = prior.get(i);
      // All boxes start inside the image. These are only initial positions;
      // every box can still be dragged anywhere on the photo.
      next.push({
        index: i, text, color: COLORS[rowColorIndex[i]], fontPx: rowFontSizes[i],
        x: previous ? previous.x : canvas.width * .08,
        y: previous ? previous.y : canvas.height * (.04 + i * .105),
        element: previous && previous.element
      });
    }
    captions = next;
    layoutCaptions();
  }
  function layoutCaptions() {
    if (!canvas.width || !stageWrap.clientWidth) return;
    const displayScale = stageWrap.clientWidth / canvas.width;
    const active = new Set(captions.map(c => c.element));
    [...overlay.children].forEach(el => { if (!active.has(el)) el.remove(); });
    captions.forEach(c => {
      if (!c.element) { c.element = document.createElement('div'); c.element.className = 'caption'; c.element.addEventListener('pointerdown', beginDrag); overlay.append(c.element); }
      const font = c.fontPx;
      const horizontalPadding = padX(c.fontPx), verticalPadding = padY(c.fontPx);
      const maxContent = Math.max(font, canvas.width - c.x - horizontalPadding * 2);
      Object.assign(c.element.style, { left: `${c.x * displayScale}px`, top: `${c.y * displayScale}px`, maxWidth: `${(maxContent + horizontalPadding * 2) * displayScale}px`, fontSize: `${font * displayScale}px`, padding: `${verticalPadding * displayScale}px ${horizontalPadding * displayScale}px`, color: c.color, background: BOX_FILL, borderRadius: `${font * BOX_RADIUS_RATIO * displayScale}px`, textShadow: `0 ${font * SHADOW_Y_RATIO * displayScale}px ${font * SHADOW_BLUR_RATIO * displayScale}px ${TEXT_SHADOW}` });
      c.element.textContent = c.text;
    });
  }
  function beginDrag(event) {
    const c = captions.find(item => item.element === event.currentTarget); if (!c) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
    drag = { c, pointerId: event.pointerId, offsetX: event.clientX * scaleX - rect.left * scaleX - c.x, offsetY: event.clientY * scaleY - rect.top * scaleY - c.y };
    event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.classList.add('dragging');
  }

  // ---------- 두 손가락 확대/이동 ----------
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  function applyView() { stageWrap.style.transform = `translate(${view.offsetX}px, ${view.offsetY}px) scale(${view.scale})`; }
  function clampView() {
    view.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale));
    const baseW = stageWrap.clientWidth, baseH = stageWrap.clientHeight;
    if (!baseW || !baseH) return;
    const margin = 60;
    const minOffsetX = baseW - baseW * view.scale - margin, maxOffsetX = margin;
    const minOffsetY = baseH - baseH * view.scale - margin, maxOffsetY = margin;
    view.offsetX = Math.min(maxOffsetX, Math.max(minOffsetX, view.offsetX));
    view.offsetY = Math.min(maxOffsetY, Math.max(minOffsetY, view.offsetY));
  }
  function resetView() { view = { scale: 1, offsetX: 0, offsetY: 0 }; applyView(); }


  overlay.addEventListener('pointerdown', event => {
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.size >= 2) {
      // 확대/이동 제스처가 시작되면, 진행 중이던 한 손가락 드래그는 취소함
      if (drag) { drag.c.element.classList.remove('dragging'); drag = null; }
      const pts = [...activePointers.values()].slice(0, 2);
      const rect0 = stageWrap.getBoundingClientRect();
      const midStart = mid(pts[0], pts[1]);
      zoomGesture = {
        originX: rect0.left - view.offsetX, originY: rect0.top - view.offsetY,
        anchorX: (midStart.x - rect0.left) / view.scale, anchorY: (midStart.y - rect0.top) / view.scale,
        scale0: view.scale, dist0: dist(pts[0], pts[1])
      };
    }
  });
  overlay.addEventListener('pointermove', event => {
    if (activePointers.has(event.pointerId)) activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (zoomGesture && activePointers.size >= 2) {
      event.preventDefault();
      const pts = [...activePointers.values()].slice(0, 2);
      const newDist = dist(pts[0], pts[1]);
      const newMid = mid(pts[0], pts[1]);
      const factor = newDist / Math.max(1, zoomGesture.dist0);
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, zoomGesture.scale0 * factor));
      view.scale = newScale;
      view.offsetX = newMid.x - zoomGesture.originX - zoomGesture.anchorX * newScale;
      view.offsetY = newMid.y - zoomGesture.originY - zoomGesture.anchorY * newScale;
      clampView(); if (view.scale <= SNAP_SCALE) view = { scale: 1, offsetX: 0, offsetY: 0 }; applyView();
      return;
    }

    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault(); const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * canvas.width / rect.width - drag.offsetX;
    const y = (event.clientY - rect.top) * canvas.height / rect.height - drag.offsetY;
    drag.c.x = Math.max(0, Math.min(canvas.width - 1, x)); drag.c.y = Math.max(0, Math.min(canvas.height - 1, y)); layoutCaptions();
  });
  function endDrag(event) {
    activePointers.delete(event.pointerId);
    if (activePointers.size < 2) { zoomGesture = null; if (view.scale <= SNAP_SCALE) resetView(); }
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.c.element.classList.remove('dragging'); drag = null;
  }
  overlay.addEventListener('pointerup', endDrag); overlay.addEventListener('pointercancel', endDrag);
  photoInput.addEventListener('change', () => {
    const file = photoInput.files && photoInput.files[0]; if (!file) return;
    const url = URL.createObjectURL(file); const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      const oldW = canvas.width, oldH = canvas.height;
      // Keep every original pixel. Drawing to this new canvas intentionally removes EXIF metadata.
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      // 사진을 바꿔도 글 상자 위치는 유지. 해상도가 다르면 비율로 옮기고 사진 안으로 보정함.
      if (oldW && oldH) captions.forEach(c => {
        c.x = Math.max(0, Math.min(canvas.width - 1, c.x * canvas.width / oldW));
        c.y = Math.max(0, Math.min(canvas.height - 1, c.y * canvas.height / oldH));
      });
      renderImage(image); hasPhoto = true; editor.hidden = false; saveButton.disabled = false;
      photoLabelText.textContent = '사진 바꾸기';
      resetView();
      // A double animation frame waits for iPhone Safari to lay out the newly visible editor.
      requestAnimationFrame(() => requestAnimationFrame(() => { syncStageToCanvas(); rebuildCaptions(); }));
    };
    image.onerror = () => say('사진을 불러오지 못했습니다. 다른 사진으로 다시 시도해 주세요.'); image.src = url;
  });
  // Do not use ResizeObserver: some installed/older iPhone Safari builds abort the
  // entire script when it is unavailable, which prevents the eight fields appearing.
  window.addEventListener('resize', () => requestAnimationFrame(syncStageToCanvas));
  saveButton.addEventListener('click', async () => {
    if (!hasPhoto || !canvas.width) return;
    const useShareSheet = SHARE_SHEET_FIRST && typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
    // 기본 방식: 탭하는 순간 새 창을 먼저 열어 iPhone Safari의 팝업 차단을 피함.
    // 완성된 JPEG가 이 창을 대체해 바로 이미지 화면이 됨. 공유 시트 방식에서는 새 창을 열지 않음.
    const preview = useShareSheet ? null : window.open('', '_blank');
    const out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.height; const outCtx = out.getContext('2d'); outCtx.drawImage(canvas, 0, 0);
    outCtx.textBaseline = 'top';
    captions.forEach(c => {
      const font = c.fontPx;
      outCtx.font = `700 ${font}px -apple-system, BlinkMacSystemFont, sans-serif`;
      const horizontalPadding = padX(c.fontPx), verticalPadding = padY(c.fontPx);
      const lines = getLines(c.text, Math.max(font, out.width - c.x - horizontalPadding * 2), c.fontPx);
      const widest = Math.min(out.width - c.x, Math.max(...lines.map(line => outCtx.measureText(line).width)) + horizontalPadding * 2);
      const boxHeight = lines.length * font * LINE_HEIGHT + verticalPadding * 2;
      outCtx.fillStyle = BOX_FILL; fillRoundRect(outCtx, c.x, c.y, widest, boxHeight, font * BOX_RADIUS_RATIO);
      outCtx.save();
      outCtx.shadowColor = TEXT_SHADOW; outCtx.shadowOffsetY = font * SHADOW_Y_RATIO; outCtx.shadowBlur = font * SHADOW_BLUR_RATIO;
      outCtx.fillStyle = c.color; lines.forEach((line, i) => outCtx.fillText(line, c.x + horizontalPadding, c.y + verticalPadding + i * font * LINE_HEIGHT));
      outCtx.restore();
    });
    const blob = await new Promise(resolve => out.toBlob(resolve, 'image/jpeg', .92));
    out.width = 0; out.height = 0; // 큰 캔버스가 차지한 메모리를 바로 돌려줌
    if (!blob) { if (preview) preview.close(); say('이미지를 만들지 못했어요. 다시 시도해 주세요.'); return; }
    if (useShareSheet) {
      // 실험 기능: 미리보기를 거치지 않고 iOS 공유 시트를 바로 엶. 실패하면 아래 파일 저장으로 넘어감.
      const file = new File([blob], 'photo-with-text.jpg', { type: 'image/jpeg' });
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file] }); say('공유 화면에서 “이미지 저장”을 누르면 사진 보관함에 저장돼요.'); return; }
        catch (err) { if (err && err.name === 'AbortError') { say('저장을 취소했어요.'); return; } }
      }
    }
    if (lastPreviewUrl) URL.revokeObjectURL(lastPreviewUrl);
    const imageUrl = URL.createObjectURL(blob); lastPreviewUrl = imageUrl;
    if (preview) { preview.location.replace(imageUrl); say('완성 사진을 새 화면으로 열었습니다. 그 화면의 공유 버튼에서 “이미지 저장”을 누르세요.'); return; }
    // Popup blocking is unusual on iPhone because the window was opened at tap time.
    // Keep a download fallback for browsers that disallow it.
    const link = document.createElement('a'); link.href = imageUrl; link.download = 'photo-with-text.jpg'; link.click(); say('사진 파일을 저장했습니다.');
  });
  // 줄 개수, 글 내용, 글씨 크기, 색상을 처음 상태(2줄, 빈 글, 중 크기, 기본 색상 순서)로 되돌림.
  function resetTextOptions() {
    visibleCount = MIN_ROWS;
    rowValues.fill('');
    rowFontSizes.fill(DEFAULT_FONT_SIZE);
    rowColorIndex.forEach((_, i) => { rowColorIndex[i] = i; });
    rowColorAuto.fill(true);
  }
  clearTextButton.addEventListener('click', () => {
    // 사진은 그대로 두고 글만 모두 지움. 몇 초 동안 되돌릴 수 있음(사진은 되돌림 대상이 아님).
    const count = filledCount();
    if (!count) { say('지울 글이 없어요.'); return; }
    const snapshot = takeSnapshot();
    resetTextOptions(); makeTextInputs();
    showUndo(`글 ${count}줄을 지웠어요`, () => restoreSnapshot(snapshot));
  });
  undoButton.addEventListener('click', () => { const action = undoAction; hideUndo(); if (action) action(); });
  // Build these before registering any optional browser features.
  makeTextInputs();
  if ('serviceWorker' in navigator) {
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then((registration) => {
        // 앱을 열 때마다 새 sw.js가 있는지 확인. 그대로면 아무 일도 안 하고,
        // 바뀌었을 때만 새로 받아온 뒤 자동으로 새로고침됨.
        registration.update();
      });
    });
  }
})();
