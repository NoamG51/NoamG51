// Crowd score: NIMA (Neural Image Assessment) on MobileNet, trained on the
// AVA dataset (~255,000 photos, each rated 1-10 by many photographers).
// Weights: idealo/image-quality-assessment (Apache-2.0), stored as float16.
// Runs fully in the browser with TensorFlow.js; loaded the first time it's needed.

const TFJS_URL = new URL("../vendor/tfjs/tf.min.js", import.meta.url).href;
const MANIFEST_URL = new URL("../models/nima/aesthetic_mobilenet.json", import.meta.url).href;
const WEIGHTS_URL = new URL("../models/nima/aesthetic_mobilenet.f16.bin", import.meta.url).href;

// MobileNet v1 (alpha 1.0) blocks: [pointwise filters, stride]
const BLOCKS = [[64, 1], [128, 2], [128, 1], [256, 2], [256, 1], [512, 2], [512, 1], [512, 1], [512, 1], [512, 1], [512, 1], [1024, 2], [1024, 1]];

let ready = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.tf) return resolve();
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("Couldn't load TensorFlow.js"));
    document.head.appendChild(s);
  });
}

function f16ToF32(u16) {
  const out = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) {
    const h = u16[i], s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
    out[i] = e === 0 ? s * 2 ** -14 * (f / 1024) : e === 31 ? (f ? NaN : s * Infinity) : s * 2 ** (e - 15) * (1 + f / 1024);
  }
  return out;
}

// Same layer layout as Keras 2.1.6 MobileNet (symmetric 1-pixel zero padding
// before every 3x3 conv), which is what these weights were trained with.
function buildModel(tf) {
  const L = tf.layers, bn = (name) => L.batchNormalization({ axis: -1, epsilon: 1e-3, name });
  const relu6 = (name) => L.reLU({ maxValue: 6, name });
  const input = tf.input({ shape: [224, 224, 3] });
  let x = L.zeroPadding2d({ padding: [[1, 1], [1, 1]], name: "conv1_pad" }).apply(input);
  x = L.conv2d({ filters: 32, kernelSize: 3, strides: 2, padding: "valid", useBias: false, name: "conv1" }).apply(x);
  x = bn("conv1_bn").apply(x);
  x = relu6("conv1_relu").apply(x);
  BLOCKS.forEach(([filters, stride], i) => {
    const id = i + 1;
    x = L.zeroPadding2d({ padding: [[1, 1], [1, 1]], name: `conv_pad_${id}` }).apply(x);
    x = L.depthwiseConv2d({ kernelSize: 3, strides: stride, padding: "valid", useBias: false, depthMultiplier: 1, name: `conv_dw_${id}` }).apply(x);
    x = bn(`conv_dw_${id}_bn`).apply(x);
    x = relu6(`conv_dw_${id}_relu`).apply(x);
    x = L.conv2d({ filters, kernelSize: 1, padding: "same", useBias: false, name: `conv_pw_${id}` }).apply(x);
    x = bn(`conv_pw_${id}_bn`).apply(x);
    x = relu6(`conv_pw_${id}_relu`).apply(x);
  });
  x = L.globalAveragePooling2d({}).apply(x);
  x = L.dense({ units: 10, activation: "softmax", name: "dense_1" }).apply(x);
  return tf.model({ inputs: input, outputs: x });
}

async function init() {
  await loadScript(TFJS_URL);
  const tf = window.tf;
  const [manifest, buf] = await Promise.all([
    fetch(MANIFEST_URL).then((r) => r.json()),
    fetch(WEIGHTS_URL).then((r) => r.arrayBuffer()),
  ]);
  const all = f16ToF32(new Uint16Array(buf));
  const model = buildModel(tf);
  // Weights are stored in Keras order: layer by layer, then kernel/gamma/beta/mean/variance.
  const byLayer = new Map();
  let off = 0;
  for (const w of manifest.weights) {
    const n = w.shape.reduce((a, b) => a * b, 1);
    const layer = w.name.split("/")[0];
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer).push(tf.tensor(all.subarray(off, off + n), w.shape));
    off += n;
  }
  for (const layer of model.layers) {
    const ws = byLayer.get(layer.name);
    if (ws) layer.setWeights(ws);
  }
  return { tf, model };
}

export function preloadCrowdScore() {
  if (!ready) ready = init().catch((e) => { ready = null; throw e; });
  return ready;
}

// Returns { mean, dist } where mean is 1-10 and dist is the predicted share
// of raters giving each score 1..10.
export async function crowdScore(source) {
  const { tf, model } = await preloadCrowdScore();
  const c = document.createElement("canvas");
  c.width = 224; c.height = 224;
  c.getContext("2d").drawImage(source, 0, 0, 224, 224); // stretch to 224x224, as in training
  const probs = tf.tidy(() => {
    const img = tf.browser.fromPixels(c).toFloat().div(127.5).sub(1).expandDims(0);
    return model.predict(img).dataSync();
  });
  const dist = Array.from(probs);
  const mean = dist.reduce((s, p, i) => s + p * (i + 1), 0);
  return { mean, dist };
}
