(() => {
  "use strict";

  const CHARSETS = {
    standard: " .:-=+*#%@",
    blocks: " ░▒▓█",
    simple: " .oO@",
    binary: " 01",
  };

  const ANSI_PALETTE = [
    [0, 0, 0],
    [128, 0, 0],
    [0, 128, 0],
    [128, 128, 0],
    [0, 0, 128],
    [128, 0, 128],
    [0, 128, 128],
    [192, 192, 192],
    [128, 128, 128],
    [255, 0, 0],
    [0, 255, 0],
    [255, 255, 0],
    [0, 0, 255],
    [255, 0, 255],
    [0, 255, 255],
    [255, 255, 255],
  ];

  const els = {
    fileInput: document.getElementById("file-input"),
    dropzone: document.getElementById("dropzone"),
    cols: document.getElementById("cols"),
    colsOut: document.getElementById("cols-out"),
    charset: document.getElementById("charset"),
    colorMode: document.getElementById("color-mode"),
    invert: document.getElementById("invert"),
    btnCopy: document.getElementById("btn-copy"),
    btnPng: document.getElementById("btn-png"),
    btnHtml: document.getElementById("btn-html"),
    status: document.getElementById("status"),
    mediaLabel: document.getElementById("media-label"),
    videoControls: document.getElementById("video-controls"),
    btnPlay: document.getElementById("btn-play"),
    fps: document.getElementById("fps"),
    fpsOut: document.getElementById("fps-out"),
    canvas: document.getElementById("ascii-canvas"),
    empty: document.getElementById("empty-state"),
  };

  const sampleCanvas = document.createElement("canvas");
  const sampleCtx = sampleCanvas.getContext("2d", { willReadFrequently: true });
  const outCtx = els.canvas.getContext("2d");

  const state = {
    kind: null, // "image" | "video"
    image: null,
    video: null,
    objectUrl: null,
    playing: false,
    raf: 0,
    lastFrameAt: 0,
    lastAscii: null, // { rows, cols, cells: [{ch,r,g,b}], cellW, cellH }
  };

  function setStatus(msg) {
    els.status.textContent = msg;
  }

  function enableActions(on) {
    els.btnCopy.disabled = !on;
    els.btnPng.disabled = !on;
    els.btnHtml.disabled = !on;
  }

  function luminance(r, g, b) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function nearestAnsi(r, g, b) {
    let best = ANSI_PALETTE[0];
    let bestDist = Infinity;
    for (const c of ANSI_PALETTE) {
      const dr = r - c[0];
      const dg = g - c[1];
      const db = b - c[2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  }

  function mapColor(r, g, b, mode) {
    switch (mode) {
      case "ansi":
        return nearestAnsi(r, g, b);
      case "mono-green": {
        const L = luminance(r, g, b) / 255;
        return [Math.round(20 + L * 40), Math.round(80 + L * 175), Math.round(40 + L * 60)];
      }
      case "mono-amber": {
        const L = luminance(r, g, b) / 255;
        return [Math.round(120 + L * 135), Math.round(70 + L * 120), Math.round(10 + L * 30)];
      }
      case "grayscale": {
        const L = Math.round(luminance(r, g, b));
        return [L, L, L];
      }
      default:
        return [r, g, b];
    }
  }

  function charForBrightness(t, charset, invert) {
    const ramp = CHARSETS[charset] || CHARSETS.standard;
    let v = Math.min(1, Math.max(0, t));
    if (invert) v = 1 - v;
    const idx = Math.min(ramp.length - 1, Math.floor(v * ramp.length));
    return ramp[idx];
  }

  function revokeUrl() {
    if (state.objectUrl) {
      URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = null;
    }
  }

  function stopVideoLoop() {
    state.playing = false;
    if (state.raf) {
      cancelAnimationFrame(state.raf);
      state.raf = 0;
    }
    if (state.video) {
      state.video.pause();
    }
    els.btnPlay.textContent = "Play";
  }

  function clearMedia() {
    stopVideoLoop();
    revokeUrl();
    state.kind = null;
    state.image = null;
    state.video = null;
    state.lastAscii = null;
    els.videoControls.hidden = true;
    els.canvas.classList.remove("visible");
    els.empty.classList.remove("hidden");
    els.mediaLabel.textContent = "No media";
    enableActions(false);
  }

  function cellSizeForFont(fontPx) {
    // Measure monospace cell using offscreen canvas
    const m = document.createElement("canvas").getContext("2d");
    m.font = `${fontPx}px "IBM Plex Mono", ui-monospace, monospace`;
    const metrics = m.measureText("M");
    const w = Math.ceil(metrics.width);
    const h = Math.ceil(fontPx * 1.15);
    return { w: Math.max(1, w), h: Math.max(1, h) };
  }

  function renderAsciiToCanvas(ascii) {
    const { rows, cols, cells, cellW, cellH } = ascii;
    const width = cols * cellW;
    const height = rows * cellH;
    els.canvas.width = width;
    els.canvas.height = height;
    outCtx.fillStyle = "#0c1014";
    outCtx.fillRect(0, 0, width, height);
    outCtx.font = `${cellH * 0.9}px "IBM Plex Mono", ui-monospace, monospace`;
    outCtx.textBaseline = "top";

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const cell = cells[y * cols + x];
        outCtx.fillStyle = `rgb(${cell.r},${cell.g},${cell.b})`;
        outCtx.fillText(cell.ch, x * cellW, y * cellH);
      }
    }

    els.canvas.classList.add("visible");
    els.empty.classList.add("hidden");
  }

  function convertFrame(source, sourceW, sourceH) {
    const cols = Number(els.cols.value);
    const fontPx = 10;
    const { w: cellW, h: cellH } = cellSizeForFont(fontPx);
    const aspect = sourceW / sourceH;
    // Character cells are taller than wide; compensate so image aspect looks right
    const cellAspect = cellW / cellH;
    const rows = Math.max(1, Math.round(cols / aspect / (1 / cellAspect)));

    sampleCanvas.width = cols;
    sampleCanvas.height = rows;
    sampleCtx.drawImage(source, 0, 0, cols, rows);
    const { data } = sampleCtx.getImageData(0, 0, cols, rows);

    const charset = els.charset.value;
    const colorMode = els.colorMode.value;
    const invert = els.invert.checked;
    const cells = new Array(cols * rows);

    for (let i = 0; i < cols * rows; i++) {
      const o = i * 4;
      const r0 = data[o];
      const g0 = data[o + 1];
      const b0 = data[o + 2];
      const a = data[o + 3] / 255;
      const r = Math.round(r0 * a);
      const g = Math.round(g0 * a);
      const b = Math.round(b0 * a);
      const bright = luminance(r, g, b) / 255;
      const [cr, cg, cb] = mapColor(r, g, b, colorMode);
      cells[i] = {
        ch: charForBrightness(bright, charset, invert),
        r: cr,
        g: cg,
        b: cb,
      };
    }

    const ascii = { rows, cols, cells, cellW, cellH };
    state.lastAscii = ascii;
    renderAsciiToCanvas(ascii);
    enableActions(true);
    return ascii;
  }

  function convertImage() {
    if (!state.image) return;
    convertFrame(state.image, state.image.naturalWidth, state.image.naturalHeight);
    setStatus(`Image · ${state.lastAscii.cols}×${state.lastAscii.rows} chars`);
  }

  function convertVideoFrame() {
    if (!state.video) return;
    const v = state.video;
    if (v.readyState < 2) return;
    convertFrame(v, v.videoWidth, v.videoHeight);
    setStatus(
      `Video · ${state.lastAscii.cols}×${state.lastAscii.rows} · ${v.currentTime.toFixed(1)}s`
    );
  }

  function videoTick(ts) {
    if (!state.playing || !state.video) return;
    const interval = 1000 / Number(els.fps.value);
    if (ts - state.lastFrameAt >= interval) {
      state.lastFrameAt = ts;
      convertVideoFrame();
    }
    state.raf = requestAnimationFrame(videoTick);
  }

  function startVideoLoop() {
    if (!state.video) return;
    state.playing = true;
    els.btnPlay.textContent = "Pause";
    state.video.play().catch(() => {
      setStatus("Tap Play to start the ASCII video preview.");
    });
    state.lastFrameAt = 0;
    state.raf = requestAnimationFrame(videoTick);
  }

  function loadFile(file) {
    if (!file) return;
    clearMedia();
    const url = URL.createObjectURL(file);
    state.objectUrl = url;
    els.mediaLabel.textContent = file.name;

    if (file.type.startsWith("video/")) {
      const video = document.createElement("video");
      video.src = url;
      video.muted = true;
      video.playsInline = true;
      video.loop = true;
      video.preload = "auto";
      state.kind = "video";
      state.video = video;
      els.videoControls.hidden = false;
      setStatus("Loading video…");
      video.addEventListener(
        "loadeddata",
        () => {
          convertVideoFrame();
          startVideoLoop();
        },
        { once: true }
      );
      video.addEventListener("error", () => {
        setStatus("Could not load that video. Try MP4 or WebM.");
      });
      return;
    }

    if (file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name)) {
      els.videoControls.hidden = true;
      const img = new Image();
      img.onload = () => {
        state.kind = "image";
        state.image = img;
        convertImage();
      };
      img.onerror = () => setStatus("Could not load that image.");
      img.src = url;
      setStatus("Loading image…");
      return;
    }

    setStatus("Unsupported file type. Use an image or video.");
    clearMedia();
  }

  function asciiToPlainText(ascii) {
    const lines = [];
    for (let y = 0; y < ascii.rows; y++) {
      let line = "";
      for (let x = 0; x < ascii.cols; x++) {
        line += ascii.cells[y * ascii.cols + x].ch;
      }
      lines.push(line);
    }
    return lines.join("\n");
  }

  function asciiToHtml(ascii) {
    const parts = [
      "<!DOCTYPE html><html><head><meta charset=\"utf-8\"/><title>Glyph ASCII</title>",
      "<style>body{margin:0;background:#0c1014;display:grid;place-items:center;min-height:100vh}",
      "pre{font:10px/1.15 'IBM Plex Mono',ui-monospace,monospace;white-space:pre;margin:1rem}</style></head><body><pre>",
    ];
    for (let y = 0; y < ascii.rows; y++) {
      for (let x = 0; x < ascii.cols; x++) {
        const c = ascii.cells[y * ascii.cols + x];
        const ch = c.ch === " " ? "&nbsp;" : escapeHtml(c.ch);
        parts.push(`<span style="color:rgb(${c.r},${c.g},${c.b})">${ch}</span>`);
      }
      parts.push("\n");
    }
    parts.push("</pre></body></html>");
    return parts.join("");
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  // Events
  els.fileInput.addEventListener("change", () => {
    const file = els.fileInput.files && els.fileInput.files[0];
    if (file) loadFile(file);
  });

  ["dragenter", "dragover"].forEach((evt) => {
    els.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      els.dropzone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach((evt) => {
    els.dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      els.dropzone.classList.remove("dragover");
    });
  });
  els.dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  els.cols.addEventListener("input", () => {
    els.colsOut.textContent = els.cols.value;
    if (state.kind === "image") convertImage();
    else if (state.kind === "video" && !state.playing) convertVideoFrame();
  });

  els.fps.addEventListener("input", () => {
    els.fpsOut.textContent = els.fps.value;
  });

  ["charset", "color-mode"].forEach((id) => {
    document.getElementById(id).addEventListener("change", () => {
      if (state.kind === "image") convertImage();
      else if (state.kind === "video" && !state.playing) convertVideoFrame();
    });
  });

  els.invert.addEventListener("change", () => {
    if (state.kind === "image") convertImage();
    else if (state.kind === "video" && !state.playing) convertVideoFrame();
  });

  els.btnPlay.addEventListener("click", () => {
    if (!state.video) return;
    if (state.playing) {
      stopVideoLoop();
      setStatus("Video paused");
    } else {
      startVideoLoop();
    }
  });

  els.btnCopy.addEventListener("click", async () => {
    if (!state.lastAscii) return;
    try {
      await navigator.clipboard.writeText(asciiToPlainText(state.lastAscii));
      setStatus("Copied plain ASCII text to clipboard");
    } catch {
      setStatus("Clipboard blocked — try Download HTML instead");
    }
  });

  els.btnPng.addEventListener("click", () => {
    if (!state.lastAscii) return;
    els.canvas.toBlob((blob) => {
      if (!blob) return;
      downloadBlob(blob, "glyph-ascii.png");
      setStatus("Downloaded PNG");
    }, "image/png");
  });

  els.btnHtml.addEventListener("click", () => {
    if (!state.lastAscii) return;
    const html = asciiToHtml(state.lastAscii);
    downloadBlob(new Blob([html], { type: "text/html" }), "glyph-ascii.html");
    setStatus("Downloaded colored HTML");
  });

  // Keep aspect on resize for images
  window.addEventListener("resize", () => {
    // no-op: canvas scales via CSS max-width
  });
})();
