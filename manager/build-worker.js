/* ErfanSh Trainer Manager — worker بیلد امن (terser) */
importScripts("terser.min.js");

self.onmessage = async function (e) {
  try {
    const out = await self.Terser.minify(e.data, {
      compress: true,
      mangle: { toplevel: true, reserved: ["imgBroken"] },
      format: { comments: false }
    });
    self.postMessage({ ok: true, code: out.code });
  } catch (err) {
    self.postMessage({ ok: false, error: String((err && err.message) || err) });
  }
};
