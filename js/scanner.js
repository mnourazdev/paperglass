/**
 * Paperglass scanning engine.
 *
 * Pipeline: decode → rotate → auto edge-detect → perspective warp →
 * illumination flattening → tone curve → optional adaptive threshold.
 * Everything runs locally on canvases.
 */

export const PREVIEW_MAX = 1200;
export const EXPORT_MAX = 2600;

export const PRESETS = {
  clean: { mode: "clean", brightness: 0, contrast: 12, cleanup: 60 },
  ink: { mode: "ink", brightness: 2, contrast: 18, cleanup: 70 },
  color: { mode: "color", brightness: 0, contrast: 6, cleanup: 45 },
  original: { mode: "original", brightness: 0, contrast: 0, cleanup: 0 },
};

const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

export function fullCorners(inset = 0.012) {
  const a = inset;
  const b = 1 - inset;
  return [
    { x: a, y: a },
    { x: b, y: a },
    { x: b, y: b },
    { x: a, y: b },
  ];
}

/* ------------------------------------------------------------------ */
/* Loading & rotation                                                  */
/* ------------------------------------------------------------------ */

export async function decodeImage(blob) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch (error) {
      try {
        return await createImageBitmap(blob);
      } catch (inner) {
        /* fall through to <img> */
      }
    }
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      resolve(image);
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This image could not be read"));
    };
    image.src = url;
  });
}

export function imageSize(bitmap) {
  return { width: bitmap.width, height: bitmap.height };
}

/**
 * Draw a source bitmap into a canvas with 0/90/180/270° rotation,
 * scaled down so its longest side is at most `maxSide`.
 */
export function renderRotated(bitmap, rotation = 0, maxSide = 1600) {
  const turn = ((rotation % 360) + 360) % 360;
  const swapped = turn === 90 || turn === 270;
  const baseWidth = swapped ? bitmap.height : bitmap.width;
  const baseHeight = swapped ? bitmap.width : bitmap.height;
  const scale = Math.min(1, maxSide / Math.max(baseWidth, baseHeight));
  const width = Math.max(1, Math.round(baseWidth * scale));
  const height = Math.max(1, Math.round(baseHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(width / 2, height / 2);
  ctx.rotate((turn * Math.PI) / 180);

  const drawWidth = swapped ? height : width;
  const drawHeight = swapped ? width : height;
  ctx.drawImage(bitmap, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  return canvas;
}

/** Rotate normalized corners by ±90°, keeping TL, TR, BR, BL order. */
export function rotateCorners(corners, direction) {
  const clockwise = direction > 0;
  const map = (point) =>
    clockwise ? { x: 1 - point.y, y: point.x } : { x: point.y, y: 1 - point.x };
  const order = clockwise ? [3, 0, 1, 2] : [1, 2, 3, 0];
  return order.map((index) => map(corners[index]));
}

/* ------------------------------------------------------------------ */
/* Auto edge detection                                                 */
/* ------------------------------------------------------------------ */

function otsuThreshold(histogram, total) {
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * histogram[i];
  let sumB = 0;
  let weightB = 0;
  let best = 0;
  let bestVariance = -1;

  for (let t = 0; t < 256; t += 1) {
    weightB += histogram[t];
    if (!weightB) continue;
    const weightF = total - weightB;
    if (!weightF) break;
    sumB += t * histogram[t];
    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;
    const variance = weightB * weightF * (meanB - meanF) * (meanB - meanF);
    if (variance > bestVariance) {
      bestVariance = variance;
      best = t;
    }
  }
  return best;
}

function histogramPercentile(histogram, total, fraction) {
  const target = total * fraction;
  let running = 0;
  for (let i = 0; i < 256; i += 1) {
    running += histogram[i];
    if (running >= target) return i;
  }
  return 255;
}

function polygonArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

function quadFromExtremes(ext) {
  const points = [
    { x: ext.minSum.x, y: ext.minSum.y }, // top-left-ish
    { x: ext.maxDiff.x, y: ext.maxDiff.y }, // top-right-ish
    { x: ext.maxSum.x, y: ext.maxSum.y }, // bottom-right-ish
    { x: ext.minDiff.x, y: ext.minDiff.y }, // bottom-left-ish
  ];

  const unique = new Set(points.map((p) => `${p.x.toFixed(2)}:${p.y.toFixed(2)}`));
  if (unique.size < 4) return null;
  return points;
}

function orderCorners(points) {
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  const sorted = [...points].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
  );
  let start = 0;
  let best = Infinity;
  sorted.forEach((p, i) => {
    const sum = p.x + p.y;
    if (sum < best) {
      best = sum;
      start = i;
    }
  });
  return [...sorted.slice(start), ...sorted.slice(0, start)];
}

function findPaperQuad(lum, width, height, threshold) {
  const total = width * height;
  const mask = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) {
    if (lum[i] >= threshold) mask[i] = 1;
  }

  const stack = new Int32Array(total);
  const components = [];

  for (let start = 0; start < total; start += 1) {
    if (mask[start] !== 1) continue;

    let top = 0;
    stack[top++] = start;
    mask[start] = 2;

    let area = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let minSum = Infinity;
    let maxSum = -Infinity;
    let minDiff = Infinity;
    let maxDiff = -Infinity;
    let minSumPoint = null;
    let maxSumPoint = null;
    let minDiffPoint = null;
    let maxDiffPoint = null;

    while (top > 0) {
      const index = stack[--top];
      const x = index % width;
      const y = (index - x) / width;
      area += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const sum = x + y;
      const diff = x - y;
      if (sum < minSum) {
        minSum = sum;
        minSumPoint = { x, y };
      }
      if (sum > maxSum) {
        maxSum = sum;
        maxSumPoint = { x, y };
      }
      if (diff < minDiff) {
        minDiff = diff;
        minDiffPoint = { x, y };
      }
      if (diff > maxDiff) {
        maxDiff = diff;
        maxDiffPoint = { x, y };
      }

      if (x > 0 && mask[index - 1] === 1) {
        mask[index - 1] = 2;
        stack[top++] = index - 1;
      }
      if (x < width - 1 && mask[index + 1] === 1) {
        mask[index + 1] = 2;
        stack[top++] = index + 1;
      }
      if (y > 0 && mask[index - width] === 1) {
        mask[index - width] = 2;
        stack[top++] = index - width;
      }
      if (y < height - 1 && mask[index + width] === 1) {
        mask[index + width] = 2;
        stack[top++] = index + width;
      }
    }

    if (area < total * 0.03) continue;

    components.push({
      area,
      minX,
      maxX,
      minY,
      maxY,
      ext: {
        minSum: minSumPoint,
        maxSum: maxSumPoint,
        minDiff: minDiffPoint,
        maxDiff: maxDiffPoint,
      },
    });
  }

  let best = null;
  const minSide = Math.min(width, height);

  for (const component of components) {
    const areaRatio = component.area / total;
    if (areaRatio > 0.985) continue;

    const boxWidth = component.maxX - component.minX + 1;
    const boxHeight = component.maxY - component.minY + 1;
    if (boxWidth < width * 0.2 || boxHeight < height * 0.2) continue;

    const raw = quadFromExtremes(component.ext);
    if (!raw) continue;

    const ordered = orderCorners(raw);
    const quadArea = polygonArea(ordered);
    if (quadArea < total * 0.1) continue;

    const boxArea = boxWidth * boxHeight;
    const compactness = quadArea / boxArea;
    if (compactness < 0.35) continue;

    const sides = ordered.map((a, i) => {
      const b = ordered[(i + 1) % 4];
      return Math.hypot(a.x - b.x, a.y - b.y);
    });
    if (Math.min(...sides) < minSide * 0.09) continue;

    const touches =
      (component.minX <= 1 ? 1 : 0) +
      (component.maxX >= width - 2 ? 1 : 0) +
      (component.minY <= 1 ? 1 : 0) +
      (component.maxY >= height - 2 ? 1 : 0);

    let score = Math.min(areaRatio, 0.92) * compactness;
    if (touches >= 3) score *= 0.4;
    if (touches === 4) score *= 0.5;

    if (!best || score > best.score) {
      best = { points: ordered, score, touches };
    }
  }

  return best;
}

/**
 * Detect the page quadrilateral. Returns normalized corners in the rotated
 * image space, or null when nothing convincing was found.
 */
export function detectCorners(bitmap, rotation = 0) {
  const small = renderRotated(bitmap, rotation, 560);
  const { width, height } = small;
  const ctx = small.getContext("2d", { willReadFrequently: true });
  const { data } = ctx.getImageData(0, 0, width, height);
  const total = width * height;

  const lum = new Float32Array(total);
  const histogram = new Uint32Array(256);
  for (let i = 0, p = 0; i < total; i += 1, p += 4) {
    const value = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    lum[i] = value;
    histogram[value | 0] += 1;
  }

  const otsu = otsuThreshold(histogram, total);
  const p72 = histogramPercentile(histogram, total, 0.72);
  const p86 = histogramPercentile(histogram, total, 0.86);
  const thresholds = [...new Set([otsu, Math.max(otsu, p72), p86, 110, 150])].filter(
    (value) => value > 24 && value < 250
  );

  let best = null;
  for (const threshold of thresholds) {
    const candidate = findPaperQuad(lum, width, height, threshold);
    if (candidate && (!best || candidate.score > best.score)) best = candidate;
    if (best && best.score > 1.15) break;
  }

  if (!best) return null;

  // Grow the mask slightly: paper edges often sit a pixel or two inside.
  const cx = best.points.reduce((sum, p) => sum + p.x, 0) / 4;
  const cy = best.points.reduce((sum, p) => sum + p.y, 0) / 4;
  const grow = 1.01;

  return best.points.map((point) => ({
    x: clamp(((point.x - cx) * grow + cx) / width, 0.002, 0.998),
    y: clamp(((point.y - cy) * grow + cy) / height, 0.002, 0.998),
  }));
}

/* ------------------------------------------------------------------ */
/* Perspective warp                                                    */
/* ------------------------------------------------------------------ */

function solveLinear(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    let maxAbs = Math.abs(a[col][col]);
    for (let row = col + 1; row < n; row += 1) {
      const value = Math.abs(a[row][col]);
      if (value > maxAbs) {
        maxAbs = value;
        pivot = row;
      }
    }
    if (maxAbs < 1e-10) throw new Error("Singular homography");
    if (pivot !== col) {
      const temp = a[col];
      a[col] = a[pivot];
      a[pivot] = temp;
    }

    const divisor = a[col][col];
    for (let k = col; k <= n; k += 1) a[col][k] /= divisor;

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      if (!factor) continue;
      for (let k = col; k <= n; k += 1) a[row][k] -= factor * a[col][k];
    }
  }

  return a.map((row) => row[n]);
}

function homographyFromRect(points, width, height) {
  const destination = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];

  const matrix = [];
  const vector = [];
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = destination[i];
    const { x: u, y: v } = points[i];
    matrix.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    vector.push(u);
    matrix.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    vector.push(v);
  }

  const [a, b, c, d, e, f, g, h] = solveLinear(matrix, vector);
  return { a, b, c, d, e, f, g, h };
}

/**
 * Warp the quadrilateral inside `source` into a straight rectangle.
 */
export function warpToRect(source, corners, maxDim = PREVIEW_MAX) {
  const sw = source.width;
  const sh = source.height;
  const points = corners.map((point) => ({
    x: clamp(point.x, 0, 1) * sw,
    y: clamp(point.y, 0, 1) * sh,
  }));

  const top = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
  const bottom = Math.hypot(points[2].x - points[3].x, points[2].y - points[3].y);
  const left = Math.hypot(points[3].x - points[0].x, points[3].y - points[0].y);
  const right = Math.hypot(points[2].x - points[1].x, points[2].y - points[1].y);

  let outWidth = Math.max(top, bottom);
  let outHeight = Math.max(left, right);
  if (!Number.isFinite(outWidth) || !Number.isFinite(outHeight) || outWidth < 12 || outHeight < 12) {
    return renderRotated(source, 0, maxDim);
  }

  const scale = Math.min(1, maxDim / Math.max(outWidth, outHeight));
  outWidth = Math.max(12, Math.round(outWidth * scale));
  outHeight = Math.max(12, Math.round(outHeight * scale));

  const output = document.createElement("canvas");
  output.width = outWidth;
  output.height = outHeight;
  const outCtx = output.getContext("2d", { willReadFrequently: true });

  let homography;
  try {
    homography = homographyFromRect(points, outWidth, outHeight);
  } catch (error) {
    outCtx.drawImage(source, 0, 0, outWidth, outHeight);
    return output;
  }

  const srcCtx = source.getContext("2d", { willReadFrequently: true });
  const srcData = srcCtx.getImageData(0, 0, sw, sh).data;
  const outData = outCtx.createImageData(outWidth, outHeight);
  const target = outData.data;
  const { a, b, c, d, e, f, g, h } = homography;

  for (let y = 0; y < outHeight; y += 1) {
    const yy = y + 0.5;
    const by = b * yy + c;
    const ey = e * yy + f;
    const hy = h * yy + 1;

    for (let x = 0; x < outWidth; x += 1) {
      const xx = x + 0.5;
      const denominator = g * xx + hy;
      let u = (a * xx + by) / denominator;
      let v = (d * xx + ey) / denominator;

      u = u < 0 ? 0 : u > sw - 1 ? sw - 1 : u;
      v = v < 0 ? 0 : v > sh - 1 ? sh - 1 : v;

      let x0 = u | 0;
      let y0 = v | 0;
      if (x0 > sw - 2) x0 = sw - 2;
      if (y0 > sh - 2) y0 = sh - 2;
      if (x0 < 0) x0 = 0;
      if (y0 < 0) y0 = 0;

      const fx = u - x0;
      const fy = v - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      const o = (y * outWidth + x) * 4;

      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      target[o] = srcData[i00] * w00 + srcData[i10] * w10 + srcData[i01] * w01 + srcData[i11] * w11;
      target[o + 1] =
        srcData[i00 + 1] * w00 + srcData[i10 + 1] * w10 + srcData[i01 + 1] * w01 + srcData[i11 + 1] * w11;
      target[o + 2] =
        srcData[i00 + 2] * w00 + srcData[i10 + 2] * w10 + srcData[i01 + 2] * w01 + srcData[i11 + 2] * w11;
      target[o + 3] = 255;
    }
  }

  outCtx.putImageData(outData, 0, 0);
  return output;
}

/* ------------------------------------------------------------------ */
/* Enhancement                                                         */
/* ------------------------------------------------------------------ */

function blurGrid(grid, gw, gh, passes = 2) {
  const temp = new Float32Array(grid.length);
  for (let pass = 0; pass < passes; pass += 1) {
    // Horizontal
    for (let y = 0; y < gh; y += 1) {
      const row = y * gw;
      for (let x = 0; x < gw; x += 1) {
        const left = grid[row + Math.max(0, x - 1)];
        const center = grid[row + x];
        const right = grid[row + Math.min(gw - 1, x + 1)];
        temp[row + x] = (left + center * 2 + right) * 0.25;
      }
    }
    // Vertical
    for (let y = 0; y < gh; y += 1) {
      for (let x = 0; x < gw; x += 1) {
        const up = temp[Math.max(0, y - 1) * gw + x];
        const center = temp[y * gw + x];
        const down = temp[Math.min(gh - 1, y + 1) * gw + x];
        grid[y * gw + x] = (up + center * 2 + down) * 0.25;
      }
    }
  }
}

function buildBackground(data, width, height) {
  const cell = Math.max(6, Math.round(Math.min(width, height) / 42));
  const gw = Math.ceil(width / cell) + 1;
  const gh = Math.ceil(height / cell) + 1;
  const bgR = new Float32Array(gw * gh);
  const bgG = new Float32Array(gw * gh);
  const bgB = new Float32Array(gw * gh);

  for (let y = 0; y < height; y += 1) {
    const row = Math.floor(y / cell) * gw;
    for (let x = 0; x < width; x += 1) {
      const index = row + Math.floor(x / cell);
      const p = (y * width + x) * 4;
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      if (r > bgR[index]) bgR[index] = r;
      if (g > bgG[index]) bgG[index] = g;
      if (b > bgB[index]) bgB[index] = b;
    }
  }

  // Fill empty cells (possible with transparent pixels) with a neutral value.
  for (let i = 0; i < bgR.length; i += 1) {
    if (!bgR[i]) bgR[i] = 1;
    if (!bgG[i]) bgG[i] = 1;
    if (!bgB[i]) bgB[i] = 1;
  }

  let meanR = 0;
  let meanG = 0;
  let meanB = 0;
  for (let i = 0; i < bgR.length; i += 1) {
    meanR += bgR[i];
    meanG += bgG[i];
    meanB += bgB[i];
  }
  meanR /= bgR.length;
  meanG /= bgG.length;
  meanB /= bgB.length;

  const neutral = (meanR + meanG + meanB) / 3;
  const wbR = clamp(neutral / Math.max(meanR, 1), 0.72, 1.38);
  const wbG = clamp(neutral / Math.max(meanG, 1), 0.72, 1.38);
  const wbB = clamp(neutral / Math.max(meanB, 1), 0.72, 1.38);

  const bgL = new Float32Array(gw * gh);
  for (let i = 0; i < bgL.length; i += 1) {
    bgL[i] = 0.299 * bgR[i] * wbR + 0.587 * bgG[i] * wbG + 0.114 * bgB[i] * wbB;
  }

  blurGrid(bgL, gw, gh, 2);

  return { cell, gw, gh, bgL, wbR, wbG, wbB };
}

function percentileFromHistogram(histogram, total, fraction) {
  const target = total * fraction;
  let running = 0;
  for (let i = 0; i < 256; i += 1) {
    running += histogram[i];
    if (running >= target) return i;
  }
  return 255;
}

function buildToneCurve(histogram, total, adjustment) {
  let lowP = 0.006;
  let highP = 0.955;
  if (adjustment.mode === "color") highP = 0.975;

  let low = percentileFromHistogram(histogram, total, lowP);
  let high = percentileFromHistogram(histogram, total, highP);
  if (high - low < 32) {
    low = Math.max(0, high - 64);
    high = Math.min(255, low + 96);
  }
  const range = Math.max(24, high - low);

  const contrast = clamp(adjustment.contrast || 0, -50, 50) * 2;
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const offset = clamp(adjustment.brightness || 0, -50, 50) * 1.6;

  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i += 1) {
    let value = ((i - low) * 255) / range;
    value = clamp(value, 0, 255);
    value = (value - 128) * factor + 128 + offset;
    lut[i] = clamp(value, 0, 255);
  }
  return lut;
}

function boxBlurGray(source, width, height) {
  const temp = new Uint8ClampedArray(source.length);
  const output = new Uint8ClampedArray(source.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const left = source[row + Math.max(0, x - 1)];
      const right = source[row + Math.min(width - 1, x + 1)];
      temp[row + x] = (left + source[row + x] * 2 + right) >> 2;
    }
  }
  for (let y = 0; y < height; y += 1) {
    const up = Math.max(0, y - 1) * width;
    const down = Math.min(height - 1, y + 1) * width;
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      output[row + x] = (temp[up + x] + temp[row + x] * 2 + temp[down + x]) >> 2;
    }
  }
  return output;
}

function integralImage(source, width, height) {
  const stride = width + 1;
  const integral = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += source[y * width + x];
      integral[(y + 1) * stride + (x + 1)] = integral[y * stride + (x + 1)] + rowSum;
    }
  }
  return integral;
}

function adaptiveThreshold(gray, width, height, cleanup) {
  const blurred = boxBlurGray(gray, width, height);
  const integral = integralImage(blurred, width, height);
  const stride = width + 1;
  const radius = Math.max(7, Math.round(Math.min(width, height) / 34));
  const bias = 0.035 + (clamp(cleanup, 0, 100) / 100) * 0.16;
  const result = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integral[(y1 + 1) * stride + (x1 + 1)] -
        integral[y0 * stride + (x1 + 1)] -
        integral[(y1 + 1) * stride + x0] +
        integral[y0 * stride + x0];
      const mean = sum / count;
      const value = blurred[y * width + x];
      result[y * width + x] = value < mean * (1 - bias) ? 1 : 0;
    }
  }

  // Remove isolated speckles that scanners often leave on blank paper.
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (!result[index]) continue;
      let neighbors = 0;
      neighbors += result[index - width - 1];
      neighbors += result[index - width];
      neighbors += result[index - width + 1];
      neighbors += result[index - 1];
      neighbors += result[index + 1];
      neighbors += result[index + width - 1];
      neighbors += result[index + width];
      neighbors += result[index + width + 1];
      if (neighbors <= 1) result[index] = 0;
    }
  }

  return result;
}

/**
 * Apply scan cleanup to a warped canvas, in place.
 */
export function enhance(canvas, adjustment = PRESETS.clean) {
  const mode = adjustment.mode || "clean";
  if (mode === "original") return canvas;

  const width = canvas.width;
  const height = canvas.height;
  const total = width * height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  const { cell, gw, gh, bgL, wbR, wbG, wbB } = buildBackground(data, width, height);
  const cleanup = clamp(adjustment.cleanup ?? 50, 0, 100) / 100;

  const histogram = new Uint32Array(256);
  for (let y = 0; y < height; y += 1) {
    const gy = y / cell;
    const y0 = Math.min(gh - 1, Math.floor(gy));
    const y1 = Math.min(gh - 1, y0 + 1);
    const fy = gy - y0;
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      const gx = x / cell;
      const x0 = Math.min(gw - 1, Math.floor(gx));
      const x1 = Math.min(gw - 1, x0 + 1);
      const fx = gx - x0;

      const background =
        (bgL[y0 * gw + x0] * (1 - fx) + bgL[y0 * gw + x1] * fx) * (1 - fy) +
        (bgL[y1 * gw + x0] * (1 - fx) + bgL[y1 * gw + x1] * fx) * fy;

      const luminance =
        0.299 * data[p] * wbR + 0.587 * data[p + 1] * wbG + 0.114 * data[p + 2] * wbB;
      const gain = background > 18 ? clamp(250 / background, 0.55, 4.5) : 1;
      const mixed = luminance * (1 + cleanup * (gain - 1));
      histogram[clamp(Math.round(mixed), 0, 255)] += 1;
    }
  }

  const lut = buildToneCurve(histogram, total, adjustment);

  if (mode === "ink") {
    const gray = new Uint8ClampedArray(total);
    for (let y = 0; y < height; y += 1) {
      const gy = y / cell;
      const y0 = Math.min(gh - 1, Math.floor(gy));
      const y1 = Math.min(gh - 1, y0 + 1);
      const fy = gy - y0;
      for (let x = 0; x < width; x += 1) {
        const p = (y * width + x) * 4;
        const gx = x / cell;
        const x0 = Math.min(gw - 1, Math.floor(gx));
        const x1 = Math.min(gw - 1, x0 + 1);
        const fx = gx - x0;
        const background =
          (bgL[y0 * gw + x0] * (1 - fx) + bgL[y0 * gw + x1] * fx) * (1 - fy) +
          (bgL[y1 * gw + x0] * (1 - fx) + bgL[y1 * gw + x1] * fx) * fy;
        const luminance =
          0.299 * data[p] * wbR + 0.587 * data[p + 1] * wbG + 0.114 * data[p + 2] * wbB;
        const gain = background > 18 ? clamp(250 / background, 0.55, 4.5) : 1;
        const mixed = luminance * (1 + cleanup * (gain - 1));
        gray[y * width + x] = lut[clamp(Math.round(mixed), 0, 255)];
      }
    }

    const bits = adaptiveThreshold(gray, width, height, adjustment.cleanup ?? 60);
    for (let i = 0, p = 0; i < total; i += 1, p += 4) {
      const value = bits[i] ? 8 : 255;
      data[p] = value;
      data[p + 1] = value;
      data[p + 2] = value;
      data[p + 3] = 255;
    }
  } else if (mode === "color") {
    for (let y = 0; y < height; y += 1) {
      const gy = y / cell;
      const y0 = Math.min(gh - 1, Math.floor(gy));
      const y1 = Math.min(gh - 1, y0 + 1);
      const fy = gy - y0;
      for (let x = 0; x < width; x += 1) {
        const p = (y * width + x) * 4;
        const gx = x / cell;
        const x0 = Math.min(gw - 1, Math.floor(gx));
        const x1 = Math.min(gw - 1, x0 + 1);
        const fx = gx - x0;
        const background =
          (bgL[y0 * gw + x0] * (1 - fx) + bgL[y0 * gw + x1] * fx) * (1 - fy) +
          (bgL[y1 * gw + x0] * (1 - fx) + bgL[y1 * gw + x1] * fx) * fy;
        const gain = background > 18 ? clamp(250 / background, 0.55, 4.5) : 1;
        const mix = 1 + cleanup * (gain - 1);

        let r = data[p] * wbR * mix;
        let g = data[p + 1] * wbG * mix;
        let b = data[p + 2] * wbB * mix;

        r = lut[clamp(Math.round(r), 0, 255)];
        g = lut[clamp(Math.round(g), 0, 255)];
        b = lut[clamp(Math.round(b), 0, 255)];

        // A touch of extra colour keeps stamps and highlights readable.
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        data[p] = clamp(l + (r - l) * 1.06, 0, 255);
        data[p + 1] = clamp(l + (g - l) * 1.06, 0, 255);
        data[p + 2] = clamp(l + (b - l) * 1.06, 0, 255);
        data[p + 3] = 255;
      }
    }
  } else {
    for (let y = 0; y < height; y += 1) {
      const gy = y / cell;
      const y0 = Math.min(gh - 1, Math.floor(gy));
      const y1 = Math.min(gh - 1, y0 + 1);
      const fy = gy - y0;
      for (let x = 0; x < width; x += 1) {
        const p = (y * width + x) * 4;
        const gx = x / cell;
        const x0 = Math.min(gw - 1, Math.floor(gx));
        const x1 = Math.min(gw - 1, x0 + 1);
        const fx = gx - x0;
        const background =
          (bgL[y0 * gw + x0] * (1 - fx) + bgL[y0 * gw + x1] * fx) * (1 - fy) +
          (bgL[y1 * gw + x0] * (1 - fx) + bgL[y1 * gw + x1] * fx) * fy;
        const gain = background > 18 ? clamp(250 / background, 0.55, 4.5) : 1;
        const luminance =
          0.299 * data[p] * wbR + 0.587 * data[p + 1] * wbG + 0.114 * data[p + 2] * wbB;
        const mixed = luminance * (1 + cleanup * (gain - 1));
        const value = lut[clamp(Math.round(mixed), 0, 255)];
        data[p] = value;
        data[p + 1] = value;
        data[p + 2] = value;
        data[p + 3] = 255;
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/* ------------------------------------------------------------------ */
/* Public render helpers                                               */
/* ------------------------------------------------------------------ */

export function renderScan(bitmap, page, maxDim = PREVIEW_MAX) {
  const sourceMax = Math.min(4600, Math.max(1600, Math.round(maxDim * 1.9)));
  const rotated = renderRotated(bitmap, page.rotation || 0, sourceMax);
  const corners = page.corners && page.corners.length === 4 ? page.corners : fullCorners();
  const warped = warpToRect(rotated, corners, maxDim);
  return enhance(warped, page);
}

export function makeThumbnail(canvas, maxSide = 132) {
  const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  const thumb = document.createElement("canvas");
  thumb.width = Math.max(1, Math.round(canvas.width * scale));
  thumb.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = thumb.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, thumb.width, thumb.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
  return thumb.toDataURL("image/jpeg", 0.86);
}

export function canvasToBlob(canvas, type = "image/jpeg", quality = 0.9) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not encode image"));
      },
      type,
      quality
    );
  });
}

export function cornersToPercent(corners) {
  return corners.map((point) => ({
    left: `${(point.x * 100).toFixed(3)}%`,
    top: `${(point.y * 100).toFixed(3)}%`,
  }));
}

export function suggestCorners(bitmap, rotation) {
  try {
    const detected = detectCorners(bitmap, rotation);
    if (detected) {
      return { corners: detected, detected: true };
    }
  } catch (error) {
    console.warn("Paperglass: edge detection failed", error);
  }
  return { corners: fullCorners(0.02), detected: false };
}
