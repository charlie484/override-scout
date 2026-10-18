// Sharing between devices without a server: compressed share links, QR codes, files.
import { copyText, downloadBlob } from './util.js';

const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
const JSQR_LIB = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
const loaded = new Map();

export function loadScript(src) {
  if (loaded.has(src)) return loaded.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = resolve; s.onerror = () => { loaded.delete(src); reject(new Error('Could not load ' + src)); };
    document.head.appendChild(s);
  });
  loaded.set(src, p);
  return p;
}

function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function encodePayload(obj) {
  const json = JSON.stringify(obj);
  if ('CompressionStream' in window) {
    try {
      const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      const buf = new Uint8Array(await new Response(stream).arrayBuffer());
      return 'z' + b64url(buf);
    } catch (e) { /* fall through */ }
  }
  return 'j' + b64url(new TextEncoder().encode(json));
}

export async function decodePayload(str) {
  const kind = str[0];
  const bytes = unb64url(str.slice(1));
  if (kind === 'z') {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return JSON.parse(await new Response(stream).text());
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export const appUrl = (route = '/') => location.origin + location.pathname + '#' + route;

export async function makeLink(route, payload) {
  return appUrl(`${route}?d=${await encodePayload(payload)}`);
}

// Render a QR code as an SVG string. Throws if the text is too long for a QR code.
export async function qrSvg(text, ecc = 'M') {
  await loadScript(QR_LIB);
  const qr = window.qrcode(0, ecc);
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${n + 4} ${n + 4}" shape-rendering="crispEdges"><rect x="-2" y="-2" width="${n + 4}" height="${n + 4}" fill="#fff"/><path d="${d}" fill="#0E0E0E"/></svg>`;
}

/** Start scanning QR codes from the rear camera into `video`. Returns a stop() function. */
export async function startScanner(video, onResult) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser cannot use the camera');
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play();
  let detector = null;
  if ('BarcodeDetector' in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    } catch (e) { detector = null; }
  }
  if (!detector) await loadScript(JSQR_LIB);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let stopped = false;
  const stop = () => { stopped = true; stream.getTracks().forEach((t) => t.stop()); };
  const tick = async () => {
    if (stopped) return;
    try {
      if (video.readyState >= 2 && video.videoWidth) {
        let value = null;
        if (detector) {
          const codes = await detector.detect(video);
          if (codes.length) value = codes[0].rawValue;
        } else {
          const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
          if (code) value = code.data;
        }
        if (value && !stopped) { stop(); onResult(value); return; }
      }
    } catch (e) { /* keep trying */ }
    setTimeout(tick, 140);
  };
  tick();
  return stop;
}

export async function shareLink({ title, text, url }) {
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  await copyText(url);
  return 'copied';
}

export async function shareFile(filename, blob, title) {
  try {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return 'shared';
    }
  } catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  downloadBlob(filename, blob);
  return 'downloaded';
}
