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

  // ---------- public API ----------

  DavePhraseEngine.prototype.overall = function (score) {
    if (!this.bank) return null;
    const band = this.getBand(score);
    return this.pickFirst(this.bank.overall?.[band]);
  };

  DavePhraseEngine.prototype.category = function (key, score) {
    if (!this.bank) return null;
    const cat = this.bank.categories?.[key];
    if (!cat) return null;
    const band = this.getBand(score);
    return this.pickFirst(cat.phrases?.[band]);
  };

  // 🔥 expose globally
  window.DavePhraseEngine = DavePhraseEngine;

})(window);
