/* ============================================================
   Dave Phrase Engine (LOCAL / OFFLINE / GLOBAL)
   ============================================================ */

(function (window) {

  function DavePhraseEngine() {
    this.bank = null;
  }

  DavePhraseEngine.prototype.load = async function () {
    if (this.bank) return;
    try {
      const res = await fetch("dave_phrases.json");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.bank = await res.json();
      console.log("🧠 Dave phrases loaded");
    } catch (err) {
      console.warn("⚠️ Dave phrases unavailable:", err.message);
      this.bank = null; // stays null — callers handle gracefully
    }
  };

  // ---------- helpers ----------

  DavePhraseEngine.prototype.getBand = function (score) {
    if (!this.bank) return "okay";
    return this.bank.meta.bands.find(
      b => score >= b.min && score <= b.max
    )?.id || "okay";
  };

  DavePhraseEngine.prototype.pickFirst = function (arr) {
    if (!arr || !arr.length) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  };

  // Normalise a phrase entry: accepts both old plain strings and new
  // { text, mateAdvice } objects. Always returns { text, mateAdvice }.
  DavePhraseEngine.prototype._normalise = function (entry) {
    if (!entry) return null;
    if (typeof entry === "string") return { text: entry, mateAdvice: null };
    return { text: entry.text ?? null, mateAdvice: entry.mateAdvice ?? null };
  };

  // ---------- public API ----------

  // Returns { text, mateAdvice } or null.
  DavePhraseEngine.prototype.overall = function (score) {
    if (!this.bank) return null;
    const band = this.getBand(score);
    return this._normalise(this.pickFirst(this.bank.overall?.[band]));
  };

  // Returns { text, mateAdvice } or null.
  DavePhraseEngine.prototype.category = function (key, score) {
    if (!this.bank) return null;
    const cat = this.bank.categories?.[key];
    if (!cat) return null;
    const band = this.getBand(score);
    return this._normalise(this.pickFirst(cat.phrases?.[band]));
  };

  // 🔥 expose globally
  window.DavePhraseEngine = DavePhraseEngine;

})(window);
