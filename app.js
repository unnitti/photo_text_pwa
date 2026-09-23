(() => {
  'use strict';
  // Fixed order requested for the eight text fields: white, red, yellow, green, orange, blue, purple, black.
  const COLORS = ['#ffffff', '#e53935', '#fdd835', '#43a047', '#fb8c00', '#1e88e5', '#8e24aa', '#111111'];
  const LINE_HEIGHT = 1.25;
  const MAX_ROWS = 8, MIN_ROWS = 2;
  // 대/중/소 글씨 크기는 실제 폰트 px 값을 그대로 사용.
  const FONT_PX_LARGE = 240, FONT_PX_MEDIUM = 180, FONT_PX_SMALL = 120;
  const DEFAULT_FONT_SIZE = FONT_PX_MEDIUM; // 기본값 "중"
  // 글 상자 여백은 폰트 크기에 비례. 28px/18px 여백이 96px 폰트 기준이었던 것을 비율로 미리 계산해둔 값.
  const PAD_X_RATIO = 28 / 96, PAD_Y_RATIO = 18 / 96;
  const photoInput = document.querySelector('#photoInput');
  const textInputs = document.querySelector('#textInputs');
  const addRowButton = document.querySelector('#addRowButton');
  const removeRowButton = document.querySelector('#removeRowButton');
  const resetTextButton = document.querySelector('#resetTextButton');
  const resetViewButton = document.querySelector('#resetViewButton');
  const canvas = document.querySelector('#photoCanvas');
  const ctx = canvas.getContext('2d');
  const stageWrap = document.querySelector('#stageWrap');
  const stageArea = document.querySelector('#stageArea');
  const overlay = document.querySelector('#overlay');
  const editor = document.querySelector('#editor');
  const saveButton = document.querySelector('#saveButton');
  const resetButton = document.querySelector('#resetButton');
  const status = document.querySelector('#status');
  let sourceImage = null;
  let captions = [];
  let drag = null;

  // 문장별로 따로 관리하는 텍스트/글씨크기. 화면에 몇 줄만 보이더라도(visibleCount),
  // 숨겨진 줄의 값은 그대로 남아있다가 다시 "+ 글 추가"를 누르면 복원됨.
  let visibleCount = MIN_ROWS;
  const rowValues = new Array(MAX_ROWS).fill('');
  rowValues[0] = '수정 전후';
  const rowFontSizes = new Array(MAX_ROWS).fill(DEFAULT_FONT_SIZE); // 기본값 "중"
  // 각 줄의 현재 색상은 COLORS 배열의 인덱스로 관리. 기본값은 기존과 동일하게
  // 줄 순서대로 하나씩(흰/빨/노/초/주/파/보/검), 버튼을 누르면 다음 색으로 순환.
  const rowColorIndex = COLORS.map((_, i) => i);

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

  function updateRowButtons() {
    addRowButton.disabled = visibleCount >= MAX_ROWS;
    removeRowButton.disabled = visibleCount <= MIN_ROWS;
  }
  function makeTextInputs() {
    // innerHTML is used here for compatibility with older iPhone Safari versions.
    textInputs.innerHTML = '';
    for (let i = 0; i < visibleCount; i++) {
      const row = document.createElement('label'); row.className = 'text-row';
      const colorBtn = document.createElement('button'); colorBtn.type = 'button'; colorBtn.className = 'color-dot';
      colorBtn.style.background = COLORS[rowColorIndex[i]]; colorBtn.setAttribute('aria-label', `${i + 1}번째 글 색상 변경`);
      colorBtn.addEventListener('click', () => {
        rowColorIndex[i] = (rowColorIndex[i] + 1) % COLORS.length;
        colorBtn.style.background = COLORS[rowColorIndex[i]];
        rebuildCaptions();
      });
      const input = document.createElement('input'); input.type = 'text'; input.placeholder = `글 ${i + 1}`; input.value = rowValues[i] || '';
      input.addEventListener('input', () => { rowValues[i] = input.value; rebuildCaptions(); });
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
      const sizeBtn = document.createElement('button'); sizeBtn.type = 'button'; sizeBtn.className = 'size-cycle-button';
      sizeBtn.textContent = fontSizeLabel(rowFontSizes[i]); sizeBtn.setAttribute('aria-label', `${i + 1}번째 글 크기 변경`);
      sizeBtn.addEventListener('click', () => {
        rowFontSizes[i] = nextFontSize(rowFontSizes[i]); sizeBtn.textContent = fontSizeLabel(rowFontSizes[i]); rebuildCaptions();
      });
      // appendChild is supported by older iPhone Safari too.
      row.appendChild(colorBtn); row.appendChild(input); row.appendChild(sizeBtn); textInputs.appendChild(row);
    }
    updateRowButtons();
    rebuildCaptions();
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
  function renderImage() { if (sourceImage) ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height); }
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
      Object.assign(c.element.style, { left: `${c.x * displayScale}px`, top: `${c.y * displayScale}px`, maxWidth: `${(maxContent + horizontalPadding * 2) * displayScale}px`, fontSize: `${font * displayScale}px`, padding: `${verticalPadding * displayScale}px ${horizontalPadding * displayScale}px`, color: c.color });
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
  resetViewButton.addEventListener('click', resetView);

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
      clampView(); applyView();
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
    if (activePointers.size < 2) zoomGesture = null;
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.c.element.classList.remove('dragging'); drag = null;
  }
  overlay.addEventListener('pointerup', endDrag); overlay.addEventListener('pointercancel', endDrag);
  photoInput.addEventListener('change', () => {
    const file = photoInput.files && photoInput.files[0]; if (!file) return;
    const url = URL.createObjectURL(file); const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      // Keep every original pixel. Drawing to this new canvas intentionally removes EXIF metadata.
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      sourceImage = image; renderImage(); editor.hidden = false; saveButton.disabled = false;
      captions = [];
      resetView();
      // A double animation frame waits for iPhone Safari to lay out the newly visible editor.
      requestAnimationFrame(() => requestAnimationFrame(() => { syncStageToCanvas(); rebuildCaptions(); }));
      say('글 상자를 사진 위에서 끌어 옮기세요.');
    };
    image.onerror = () => say('사진을 불러오지 못했습니다. 다른 사진으로 다시 시도해 주세요.'); image.src = url;
  });
  // Do not use ResizeObserver: some installed/older iPhone Safari builds abort the
  // entire script when it is unavailable, which prevents the eight fields appearing.
  window.addEventListener('resize', () => requestAnimationFrame(syncStageToCanvas));
  saveButton.addEventListener('click', async () => {
    if (!sourceImage || !canvas.width) return;
    // Open synchronously under the tap gesture so iPhone Safari does not block it.
    // The completed JPEG then replaces this page, giving a direct image-view screen.
    const preview = window.open('', '_blank');
    const out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.height; const outCtx = out.getContext('2d'); outCtx.drawImage(canvas, 0, 0);
    outCtx.textBaseline = 'top';
    captions.forEach(c => {
      const font = c.fontPx;
      outCtx.font = `700 ${font}px -apple-system, BlinkMacSystemFont, sans-serif`;
      const horizontalPadding = padX(c.fontPx), verticalPadding = padY(c.fontPx);
      const lines = getLines(c.text, Math.max(font, out.width - c.x - horizontalPadding * 2), c.fontPx);
      const widest = Math.min(out.width - c.x, Math.max(...lines.map(line => outCtx.measureText(line).width)) + horizontalPadding * 2);
      const boxHeight = lines.length * font * LINE_HEIGHT + verticalPadding * 2;
      outCtx.fillStyle = 'rgba(105,105,105,.56)'; outCtx.fillRect(c.x, c.y, widest, boxHeight);
      outCtx.fillStyle = c.color; lines.forEach((line, i) => outCtx.fillText(line, c.x + horizontalPadding, c.y + verticalPadding + i * font * LINE_HEIGHT));
    });
    const blob = await new Promise(resolve => out.toBlob(resolve, 'image/jpeg', .92));
    const imageUrl = URL.createObjectURL(blob);
    if (preview) { preview.location.replace(imageUrl); say('완성 사진을 새 화면으로 열었습니다. 그 화면의 공유 버튼에서 “이미지 저장”을 누르세요.'); return; }
    // Popup blocking is unusual on iPhone because the window was opened at tap time.
    // Keep a download fallback for browsers that disallow it.
    const link = document.createElement('a'); link.href = imageUrl; link.download = 'photo-with-text.jpg'; link.click(); say('사진 파일을 저장했습니다.');
  });
  // 줄 개수, 글 내용, 글씨 크기, 색상을 처음 상태(2줄, "수정 전후", 중 크기, 기본 색상 순서)로 되돌림.
  // "새 작업 시작"과 "글 초기화" 버튼이 공통으로 사용.
  function resetTextOptions() {
    visibleCount = MIN_ROWS;
    rowValues.fill('');
    rowValues[0] = '수정 전후';
    rowFontSizes.fill(DEFAULT_FONT_SIZE);
    rowColorIndex.forEach((_, i) => { rowColorIndex[i] = i; });
  }
  resetButton.addEventListener('click', () => {
    photoInput.value = ''; sourceImage = null; captions = []; overlay.innerHTML = '';
    ctx.clearRect(0, 0, canvas.width, canvas.height); editor.hidden = true; saveButton.disabled = true;
    resetView();
    // "새 작업 시작"은 사진과 함께 글 옵션도 모두 처음 상태로 되돌림.
    // (반면 "사진 선택"으로 다음 사진만 고를 때는 이 값들을 그대로 유지함.)
    resetTextOptions();
    makeTextInputs(); say('새 사진을 선택해 작업을 시작하세요.');
  });
  resetTextButton.addEventListener('click', () => {
    // 사진은 그대로 두고, 글 관련 옵션만 처음 상태로 되돌림.
    resetTextOptions();
    makeTextInputs(); say('글 옵션을 기본값으로 되돌렸습니다.');
  });
  addRowButton.addEventListener('click', () => { if (visibleCount < MAX_ROWS) { visibleCount++; makeTextInputs(); } });
  removeRowButton.addEventListener('click', () => {
  if (visibleCount > MIN_ROWS) {
    const removedIndex = visibleCount - 1;
    rowValues[removedIndex] = '';
    rowFontSizes[removedIndex] = DEFAULT_FONT_SIZE;
    rowColorIndex[removedIndex] = removedIndex;
    visibleCount--;
    makeTextInputs();
  }
  });
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
      navigator.serviceWorker.register('./sw.js?v=0.11').then((registration) => {
        // 앱을 열 때마다 새 sw.js가 있는지 확인. 그대로면 아무 일도 안 하고,
        // 바뀌었을 때만 새로 받아온 뒤 자동으로 새로고침됨.
        registration.update();
      });
    });
  }
})();
