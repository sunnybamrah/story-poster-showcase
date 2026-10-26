// Photos stay on the device until the parent starts a drawing.
export const photoInputLimit = 32 * 1024 * 1024;
export const photoAccept = 'image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,image/gif,.heic,.heif';

async function nativePicture(blob) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image', resizeWidth: 1536, resizeQuality: 'high' }); } catch {}
  }
  const url = URL.createObjectURL(blob), picture = new Image();
  try {
    await new Promise((resolve, reject) => { picture.onload = resolve; picture.onerror = reject; picture.src = url; });
    return picture;
  } finally { URL.revokeObjectURL(url); }
}

export async function preparePhoto(file) {
  if (!file?.size || file.size > photoInputLimit) throw Error('Choose a photo smaller than 32 MB.');
  const header = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const brands = new TextDecoder('ascii').decode(header);
  const heic = /ftyp/.test(brands) && /heic|heix|hevc|hevx|mif1|msf1/.test(brands);
  const supported = heic || /^image\/(jpeg|png|webp|avif|gif)$/.test(file.type)
    || /\.(jpe?g|png|webp|avif|gif|heic|heif)$/i.test(file.name ?? '');
  if (!supported) throw Error('Choose a photo from your photo library: HEIC, JPG, PNG, WebP, AVIF or GIF.');
  let picture;
  try {
    try { picture = await nativePicture(file); }
    catch (error) {
      if (!heic) throw error;
      const buffer = await file.arrayBuffer();
      let worker;
      try {
        // Same-origin worker asset: no blob worker or relaxed script policy.
        worker = new Worker(new URL('../node_modules/heic-to/src/worker.js', import.meta.url), { type: 'module' });
        const pixels = await new Promise((resolve, reject) => {
          worker.onmessage = event => event.data.error ? reject(Error(event.data.error)) : resolve(event.data.imageData);
          worker.onerror = () => reject(Error('Photo decoder could not start'));
          worker.postMessage({ id: 'photo', buffer }, [buffer]);
        });
        picture = await createImageBitmap(pixels);
      } finally { worker?.terminate(); }

    }
    const width = picture.naturalWidth || picture.width, height = picture.naturalHeight || picture.height;
    if (!width || !height || width * height > 100_000_000) throw Error('Invalid dimensions');
    const scale = Math.min(1, 1536 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(picture, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .94));
    canvas.width = canvas.height = 1;
    if (!blob?.size) throw Error('Empty image');
    return new File([blob], 'story-photo.jpg', { type: 'image/jpeg' });
  } catch {
    throw Error('This photo could not be opened. Choose it again from your photo library, or try another photo.');
  } finally { picture?.close?.(); }
}
