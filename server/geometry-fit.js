const validRect = r => r && ['x', 'y', 'w', 'h'].every(key => Number.isFinite(r[key])) && r.w > 0 && r.h > 0;
export const transformRect = (rect, fit) => ({ ...rect, x: fit.scale * rect.x + fit.offset.x, y: fit.scale * rect.y + fit.offset.y, w: fit.scale * rect.w, h: fit.scale * rect.h });
export const boundsOf = rects => ({ x: Math.min(...rects.map(r => r.x)), y: Math.min(...rects.map(r => r.y)),
  w: Math.max(...rects.map(r => r.x + r.w)) - Math.min(...rects.map(r => r.x)), h: Math.max(...rects.map(r => r.y + r.h)) - Math.min(...rects.map(r => r.y)) });

// Minimize the sum of squared x, y, width and height residuals for every box.
// One scale is shared by both axes. No stretching or per-box adjustment.
export function fitRectangles(observed, expected, page = { width: 612, height: 792 }) {
  const pairs = observed.filter(r => validRect(r) && expected[r.id]);
  if (!pairs.length) throw new Error('No measured rectangles to fit.');
  const average = (key, target = false) => pairs.reduce((sum, r) => sum + (target ? expected[r.id][key] : r[key]), 0) / pairs.length;
  const mx = average('x'), my = average('y'), tx = average('x', true), ty = average('y', true);
  let numerator = 0, denominator = 0;
  for (const r of pairs) {
    const t = expected[r.id];
    numerator += (r.x - mx) * (t.x - tx) + (r.y - my) * (t.y - ty) + r.w * t.w + r.h * t.h;
    denominator += (r.x - mx) ** 2 + (r.y - my) ** 2 + r.w ** 2 + r.h ** 2;
  }
  const scale = numerator / denominator;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Measured rectangles have no positive uniform fit.');
  const fit = { scale, offset: { x: tx - scale * mx, y: ty - scale * my } };
  const residuals = pairs.map(r => {
    const fitted = transformRect(r, fit), target = expected[r.id];
    const points = Object.fromEntries(['x', 'y', 'w', 'h'].map(key => [key, fitted[key] - target[key]]));
    const pageFraction = Object.fromEntries(Object.entries(points).map(([key, value]) => [key, value / (['x', 'w'].includes(key) ? page.width : page.height)]));
    return { id: r.id, observed: r, fitted, target, points, pageFraction };
  });
  return { ...fit, method: 'least-squares-x-y-width-height', residuals };
}
export function fitInsideSafeArea(fit, observed, { width, height }, margin = 36) {
  const fittedBounds = boundsOf(observed.map(r => transformRect(r, fit)));
  const insetScale = Math.min((width - 2 * margin) / fittedBounds.w, (height - 2 * margin) / fittedBounds.h);
  const offset = { x: (width - fittedBounds.w * insetScale) / 2 - fittedBounds.x * insetScale,
    y: (height - fittedBounds.h * insetScale) / 2 - fittedBounds.y * insetScale };
  const placement = { scale: fit.scale * insetScale, offset: { x: fit.offset.x * insetScale + offset.x, y: fit.offset.y * insetScale + offset.y }, insetScale };
  const bounds = boundsOf(observed.map(r => transformRect(r, placement)));
  return { ...placement, bounds, margins: { left: bounds.x, right: width - bounds.x - bounds.w, top: bounds.y, bottom: height - bounds.y - bounds.h } };
}
export function measurementProblems(receipt, sourceCanvas) {
  const problems = [], canvas = receipt.coordinateSpace ?? { width: 612, height: 792, unit: 'letter-points' };
  if (!['source-pixels', 'letter-points'].includes(canvas.unit) || !Number.isFinite(canvas.width) || !Number.isFinite(canvas.height) || canvas.width <= 0 || canvas.height <= 0) problems.push('State the coordinate unit and the image width and height.');
  if (canvas.unit === 'source-pixels' && (canvas.width !== sourceCanvas.width || canvas.height !== sourceCanvas.height)) problems.push('Coordinate space must match the actual source image dimensions.');
  if (canvas.unit === 'letter-points' && (canvas.width !== 612 || canvas.height !== 792)) problems.push('Legacy Letter coordinates must use a 612 by 792 page.');
  for (const r of receipt.observed) {
    if (!validRect(r)) { problems.push(`Measure a real positive rectangle for ${r?.id ?? 'unknown box'}.`); continue; }
    if (r.x < -1 || r.y < -1 || r.x + r.w > canvas.width + 1 || r.y + r.h > canvas.height + 1) problems.push(`${r.id} extends outside the declared ${canvas.width} by ${canvas.height} coordinate space. Re-measure the actual image in source pixels.`);
  }
  return { problems, canvas };
}
