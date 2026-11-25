// Screenshot cropping and encoding helpers for the side panel.

export async function dataUrlToBitmap(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  return createImageBitmap(blob);
}

export function crop(source, x, y, w, h, maxSide = Infinity) {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = new OffscreenCanvas(cw, ch);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, x, y, w, h, 0, 0, cw, ch);
  return canvas;
}

export async function toImagePart(canvas, mimeType = "image/jpeg", quality = 0.9) {
  const blob = await canvas.convertToBlob({ type: mimeType, quality });
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return { inlineData: { data: base64, mimeType } };
}
