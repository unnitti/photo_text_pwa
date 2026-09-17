(() => {
  'use strict';
  // Fixed order requested for the eight text fields: white, red, yellow, green, orange, blue, purple, black.
  const COLORS = ['#ffffff', '#e53935', '#fdd835', '#43a047', '#fb8c00', '#1e88e5', '#8e24aa', '#111111'];
  const BASE_FONT = 96, BASE_PAD_X = 28, BASE_PAD_Y = 18, LINE_HEIGHT = 1.25;
  let FONT = BASE_FONT * 2;
  const photoInput = document.querySelector('#photoInput');
  const textInputs = document.querySelector('#textInputs');
  const canvas = document.querySelector('#photoCanvas');
  const ctx = canvas.getContext('2d');
  const stageWrap = document.querySelector('#stageWrap');
  const stageArea = document.querySelector('#stageArea');
  const overlay = document.querySelector('#overlay');
  const editor = document.querySelector('#editor');
  const saveButton = document.querySelector('#saveButton');
  const resetButton = document.querySelector('#resetButton');
  const status = document.querySelector('#status');
  const sizeButtons = [...document.querySelectorAll('.size-button')];
  let sourceImage = null;
  let captions = [];
  let drag = null;

  function say(message) { status.textContent = message; }
  function padX() { return BASE_PAD_X * FONT / BASE_FONT; }
  function padY() { return BASE_PAD_Y * FONT / BASE_FONT; }
  function setFontScale(scale) {
    FONT = BASE_FONT * scale;
    sizeButtons.forEach(button => {
      const active = Number(button.dataset.size) === scale;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
    layoutCaptions();
  }
  function makeTextInputs() {
    const count = 8;
    const old = [...textInputs.querySelectorAll('input')].map(x => x.value);
    // innerHTML is used here for compatibility with older iPhone Safari versions.
    textInputs.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const row = document.createElement('label'); row.className = 'text-row';
      const dot = document.createElement('span'); dot.className = 'color-dot'; dot.style.background = COLORS[i % COLORS.length];
      const input = document.createElement('input'); input.type = 'text'; input.placeholder = `문장 ${i + 1}`; input.value = old[i] || (i === 0 ? '작업 전후' : '');
      input.addEventListener('input', rebuildCaptions);
      // appendChild is supported by older iPhone Safari too.
      row.appendChild(dot); row.appendChild(input); textInputs.appendChild(row);
    }
    rebuildCaptions();
  }
  function getLines(text, maxWidth) {
    ctx.font = `700 ${FONT}px -apple-system, BlinkMacSystemFont, sans-serif`;
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
    const values = [...textInputs.querySelectorAll('input')].map(x => x.value.trim());
    const prior = new Map(captions.map(c => [c.index, c]));
    captions = values.map((text, index) => {
      const previous = prior.get(index);
      // All eight starting boxes remain inside the image. They are only initial
      // positions; every box can still be dragged anywhere on the photo.
      return { index, text, color: COLORS[index % COLORS.length], x: previous ? previous.x : canvas.width * .08, y: previous ? previous.y : canvas.height * (.04 + index * .105), element: previous && previous.element };
    }).filter(c => c.text);
    layoutCaptions();
  }
  function layoutCaptions() {
    if (!canvas.width || !stageWrap.clientWidth) return;
    const scale = stageWrap.clientWidth / canvas.width;
    const active = new Set(captions.map(c => c.element));
    [...overlay.children].forEach(el => { if (!active.has(el)) el.remove(); });
    captions.forEach(c => {
      if (!c.element) { c.element = document.createElement('div'); c.element.className = 'caption'; c.element.addEventListener('pointerdown', beginDrag); overlay.append(c.element); }
      const horizontalPadding = padX(), verticalPadding = padY();
      const maxContent = Math.max(FONT, canvas.width - c.x - horizontalPadding * 2);
      Object.assign(c.element.style, { left: `${c.x * scale}px`, top: `${c.y * scale}px`, maxWidth: `${(maxContent + horizontalPadding * 2) * scale}px`, fontSize: `${FONT * scale}px`, padding: `${verticalPadding * scale}px ${horizontalPadding * scale}px`, color: c.color });
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
  overlay.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault(); const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * canvas.width / rect.width - drag.offsetX;
    const y = (event.clientY - rect.top) * canvas.height / rect.height - drag.offsetY;
    drag.c.x = Math.max(0, Math.min(canvas.width - 1, x)); drag.c.y = Math.max(0, Math.min(canvas.height - 1, y)); layoutCaptions();
  });
  function endDrag(event) { if (!drag || event.pointerId !== drag.pointerId) return; drag.c.element.classList.remove('dragging'); drag = null; }
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
      // A double animation frame waits for iPhone Safari to lay out the newly visible editor.
      requestAnimationFrame(() => requestAnimationFrame(() => { syncStageToCanvas(); rebuildCaptions(); }));
      say('문장 상자를 사진 위에서 끌어 옮기세요.');
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
    outCtx.textBaseline = 'top'; outCtx.font = `700 ${FONT}px -apple-system, BlinkMacSystemFont, sans-serif`;
    captions.forEach(c => {
      const horizontalPadding = padX(), verticalPadding = padY();
      const lines = getLines(c.text, Math.max(FONT, out.width - c.x - horizontalPadding * 2));
      const widest = Math.min(out.width - c.x, Math.max(...lines.map(line => outCtx.measureText(line).width)) + horizontalPadding * 2);
      const boxHeight = lines.length * FONT * LINE_HEIGHT + verticalPadding * 2;
      outCtx.fillStyle = 'rgba(105,105,105,.56)'; outCtx.fillRect(c.x, c.y, widest, boxHeight);
      outCtx.fillStyle = c.color; lines.forEach((line, i) => outCtx.fillText(line, c.x + horizontalPadding, c.y + verticalPadding + i * FONT * LINE_HEIGHT));
    });
    const blob = await new Promise(resolve => out.toBlob(resolve, 'image/jpeg', .92));
    const imageUrl = URL.createObjectURL(blob);
    if (preview) { preview.location.replace(imageUrl); say('완성 사진을 새 화면으로 열었습니다. 그 화면의 공유 버튼에서 “이미지 저장”을 누르세요.'); return; }
    // Popup blocking is unusual on iPhone because the window was opened at tap time.
    // Keep a download fallback for browsers that disallow it.
    const link = document.createElement('a'); link.href = imageUrl; link.download = 'photo-with-text.jpg'; link.click(); say('사진 파일을 저장했습니다.');
  });
  resetButton.addEventListener('click', () => {
    photoInput.value = ''; sourceImage = null; captions = []; overlay.innerHTML = '';
    ctx.clearRect(0, 0, canvas.width, canvas.height); editor.hidden = true; saveButton.disabled = true;
    makeTextInputs(); say('새 사진을 선택해 작업을 시작하세요.');
  });
  sizeButtons.forEach(button => button.addEventListener('click', () => setFontScale(Number(button.dataset.size))));
  // Build these before registering any optional browser features.
  makeTextInputs();
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js?v=0.8'));
})();
