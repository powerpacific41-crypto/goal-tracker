// Camera capture for completion photos, with a "live pic" watermark.
//
// Preferred path: an in-app live camera (getUserMedia). The photo is taken from the live video
// and stamped on the spot, so there is no gallery picker to choose an old photo from.
// Fallback (no camera permission / unsupported browser): the phone's camera app via <input capture>.
// That photo must be very recent and is labelled "CAMERA APP" so the partner knows it is a weaker proof.
//
// The watermark carries the one-time code the server issued for THIS completion (GT-XXXX), the user's
// name and the capture time. The server checks the code when the photo is submitted, and the partner
// compares it with the code shown in the app. Must be called from a click/tap handler.
window.Camera = {
  MAX_SIDE: 1280,
  QUALITY: 0.72,
  FALLBACK_MAX_AGE_MS: 3 * 60 * 1000,

  /** info: { code, who, title }. Resolves { base64, mime, sizeKb, takenAt, previewUrl, source }. */
  async capture(info) {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try { return await Camera.live(info); }
      catch (e) { if (e && e.code === 'CANCELLED') throw e; /* denied or no camera: use the fallback */ }
    }
    return Camera.fallback(info);
  },

  cancelled(msg) {
    const e = new Error(msg || 'No photo was taken.');
    e.code = 'CANCELLED';
    return e;
  },

  /* ---------- live camera ---------- */
  live(info) {
    return new Promise((resolve, reject) => {
      let stream = null;
      let facing = 'environment';
      const el = document.createElement('div');
      el.className = 'cam-overlay';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', 'Take a live photo');
      el.innerHTML = `
        <video playsinline muted autoplay></video>
        <div class="cam-hud"><span class="cam-live">&#9679; LIVE</span><span class="cam-code"></span></div>
        <p class="cam-title"></p>
        <div class="cam-bar">
          <button type="button" class="cam-btn" data-c="cancel">Cancel</button>
          <button type="button" class="cam-shutter" data-c="shoot" aria-label="Take photo"></button>
          <button type="button" class="cam-btn" data-c="flip">Flip</button>
        </div>`;
      el.querySelector('.cam-code').textContent = info.code;
      el.querySelector('.cam-title').textContent = info.title || '';
      document.body.appendChild(el);
      document.body.classList.add('cam-open');
      const video = el.querySelector('video');

      const stop = () => {
        if (stream) stream.getTracks().forEach((t) => t.stop());
        stream = null;
      };
      const close = () => {
        stop();
        document.removeEventListener('keydown', onKey);
        document.body.classList.remove('cam-open');
        el.remove();
      };
      const onKey = (e) => { if (e.key === 'Escape') { close(); reject(Camera.cancelled()); } };
      document.addEventListener('keydown', onKey);

      const start = async () => {
        stop();
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false
        });
        video.srcObject = stream;
        await video.play().catch(() => {});
      };

      start().catch((err) => { close(); reject(err); }); // permission denied -> capture() falls back

      el.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-c]');
        if (!b) return;
        if (b.dataset.c === 'cancel') { close(); reject(Camera.cancelled()); }
        else if (b.dataset.c === 'flip') {
          const prev = facing;
          facing = facing === 'environment' ? 'user' : 'environment';
          try { await start(); } catch (err) { facing = prev; start().catch(() => {}); }
        } else if (b.dataset.c === 'shoot') {
          if (!video.videoWidth) return;
          b.disabled = true;
          try {
            const result = await Camera.render(video, video.videoWidth, video.videoHeight, info, 'live');
            close();
            resolve(result);
          } catch (err) { close(); reject(err); }
        }
      });
    });
  },

  /* ---------- fallback: phone camera app ---------- */
  fallback(info) {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.setAttribute('capture', 'environment');
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return reject(Camera.cancelled());
        if (file.lastModified && Date.now() - file.lastModified > Camera.FALLBACK_MAX_AGE_MS) {
          return reject(new Error('That photo is too old. Take a new one with your camera.'));
        }
        try {
          const bmp = await createImageBitmap(file);
          resolve(await Camera.render(bmp, bmp.width, bmp.height, info, 'camera-app'));
        } catch (e) { reject(new Error('Could not read that photo. Try again.')); }
      });
      input.addEventListener('cancel', () => reject(Camera.cancelled('A photo is required to complete this quest.')));
      input.click();
    });
  },

  /* ---------- drawing, watermark, export ---------- */
  async render(source, sw, sh, info, kind) {
    const scale = Math.min(1, Camera.MAX_SIDE / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const takenAt = new Date();
    Camera.stamp(ctx, canvas.width, canvas.height, info, kind, takenAt);

    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', Camera.QUALITY));
    if (!blob) throw new Error('Could not process the photo.');
    const dataUrl = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
    return {
      base64: dataUrl.split(',')[1],
      mime: 'image/jpeg',
      sizeKb: Math.round(blob.size / 1024),
      takenAt: takenAt.toISOString(),
      source: kind,
      previewUrl: dataUrl
    };
  },

  /** Faint diagonal pattern across the whole picture (hard to crop out) plus a solid banner at the bottom. */
  stamp(ctx, w, h, info, kind, when) {
    const u = Math.max(12, Math.round(w / 38));
    const live = kind === 'live';

    ctx.save();
    ctx.globalAlpha = 0.17;
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 ' + Math.round(u * 1.05) + 'px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-Math.PI / 7);
    const text = (live ? 'LIVE ' : 'CAM ') + info.code;
    const stepX = u * 9, stepY = u * 4.6;
    let row = 0;
    for (let y = -h; y < h; y += stepY, row++) {
      for (let x = -w; x < w; x += stepX) ctx.fillText(text, x + (row % 2) * stepX / 2, y);
    }
    ctx.restore();

    const bh = Math.round(u * 3.6);
    ctx.fillStyle = 'rgba(8, 24, 30, 0.82)';
    ctx.fillRect(0, h - bh, w, bh);
    ctx.fillStyle = live ? '#ff3b30' : '#e8a317';
    ctx.beginPath();
    ctx.arc(u * 0.9, h - bh + u * 1.1, u * 0.38, 0, Math.PI * 2);
    ctx.fill();

    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 ' + Math.round(u * 0.95) + 'px system-ui, sans-serif';
    ctx.fillText((live ? 'LIVE PIC' : 'CAMERA APP PIC') + '   ' + info.code, u * 1.6, h - bh + u * 1.45);
    ctx.font = '500 ' + Math.round(u * 0.8) + 'px system-ui, sans-serif';
    const stampText = when.toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' });
    ctx.fillText(Camera.fit(ctx, (info.who || '') + '  \u00b7  ' + stampText, w - u * 2), u * 0.9, h - bh + u * 2.5);
    ctx.fillStyle = '#b9d2da';
    ctx.fillText(Camera.fit(ctx, info.title || '', w - u * 2), u * 0.9, h - bh + u * 3.35);
  },

  fit(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    while (text.length > 1 && ctx.measureText(text + '\u2026').width > maxWidth) text = text.slice(0, -1);
    return text + '\u2026';
  }
};
