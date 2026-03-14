/**
 * THREE.DragControls
 * Raycaster-based drag controls that lock movement to the XZ plane.
 * Attaches to the THREE global set by three.min.js (UMD pattern).
 *
 * API mirrors the official Three.js DragControls addon:
 *   const dc = new THREE.DragControls(objects, camera, domElement);
 *   dc.addEventListener('dragstart', e => orbitControls.enabled = false);
 *   dc.addEventListener('dragend',   e => orbitControls.enabled = true);
 *   dc.addEventListener('hoveron',   e => e.object.material.emissive.set(0x10b981));
 *   dc.addEventListener('hoveroff',  e => e.object.material.emissive.set(0x000000));
 *   dc.addEventListener('drag',      e => { e.object.position.y = floorY; });
 */
(function () {
  'use strict';

  const THREE = globalThis.THREE;
  if (!THREE) {
    console.warn('[DragControls] THREE not found on globalThis — load three.min.js first.');
    return;
  }

  // ── DragControls constructor ────────────────────────────────
  function DragControls(objects, camera, domElement) {
    // EventDispatcher mixin
    THREE.EventDispatcher.call(this);

    const _raycaster  = new THREE.Raycaster();
    const _mouse      = new THREE.Vector2();
    const _dragPlane  = new THREE.Plane();
    const _intersection = new THREE.Vector3();
    const _offset     = new THREE.Vector3();
    const _worldPos   = new THREE.Vector3();

    let _selected     = null;
    let _hovered      = null;
    let _enabled      = true;

    const _rect = () => domElement.getBoundingClientRect();

    function _toNDC(e) {
      const r  = _rect();
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      _mouse.x =  ((cx - r.left) / r.width)  * 2 - 1;
      _mouse.y = -((cy - r.top)  / r.height) * 2 + 1;
    }

    function _intersectObjects() {
      _raycaster.setFromCamera(_mouse, camera);
      return _raycaster.intersectObjects(objects, true);
    }

    // ── pointermove ────────────────────────────────────────────
    function onPointerMove(e) {
      if (!_enabled) return;
      _toNDC(e);

      if (_selected) {
        // Drag — intersect the locked XZ plane
        _raycaster.setFromCamera(_mouse, camera);
        if (_raycaster.ray.intersectPlane(_dragPlane, _intersection)) {
          _selected.position.copy(_intersection.sub(_offset));
          // Restore Y — drag is XZ only
          _selected.position.y = _dragPlane.constant * -1;
        }
        domElement.style.cursor = 'grabbing';
        this.dispatchEvent({ type: 'drag', object: _selected });
        return;
      }

      // Hover detection
      const hits = _intersectObjects();
      if (hits.length > 0) {
        const obj = hits[0].object;
        if (_hovered !== obj) {
          if (_hovered) this.dispatchEvent({ type: 'hoveroff', object: _hovered });
          _hovered = obj;
          domElement.style.cursor = 'grab';
          this.dispatchEvent({ type: 'hoveron', object: _hovered });
        }
      } else {
        if (_hovered) {
          this.dispatchEvent({ type: 'hoveroff', object: _hovered });
          _hovered = null;
        }
        domElement.style.cursor = '';
      }
    }

    // ── pointerdown ───────────────────────────────────────────
    function onPointerDown(e) {
      if (!_enabled) return;
      _toNDC(e);

      const hits = _intersectObjects();
      if (hits.length === 0) return;

      _selected = hits[0].object;
      _raycaster.setFromCamera(_mouse, camera);

      // Build horizontal drag plane at the object's current Y
      const floorY = _selected.position.y;
      _dragPlane.setFromNormalAndCoplanarPoint(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(0, floorY, 0)
      );
      // Store constant as positive Y for restore in pointermove
      _dragPlane.constant = -floorY;

      if (_raycaster.ray.intersectPlane(_dragPlane, _intersection)) {
        _offset.copy(_intersection).sub(_selected.position);
      }

      domElement.style.cursor = 'grabbing';
      if (e.pointerId != null) domElement.setPointerCapture(e.pointerId);
      e.stopPropagation();

      this.dispatchEvent({ type: 'dragstart', object: _selected });
    }

    // ── pointerup ────────────────────────────────────────────
    function onPointerUp(e) {
      if (!_enabled) return;
      if (_selected) {
        this.dispatchEvent({ type: 'dragend', object: _selected });
        _selected = null;
      }
      domElement.style.cursor = _hovered ? 'grab' : '';
    }

    // Bind with correct `this`
    const _onMove  = onPointerMove.bind(this);
    const _onDown  = onPointerDown.bind(this);
    const _onUp    = onPointerUp.bind(this);

    domElement.addEventListener('pointermove', _onMove, { passive: true });
    domElement.addEventListener('pointerdown', _onDown, { passive: false });
    domElement.addEventListener('pointerup',   _onUp,   { passive: true });

    // ── Public API ────────────────────────────────────────────
    Object.defineProperty(this, 'enabled', {
      get() { return _enabled; },
      set(v) { _enabled = !!v; if (!v) { _selected = null; _hovered = null; } }
    });

    this.getObjects = () => objects;

    this.deactivate = function () {
      domElement.removeEventListener('pointermove', _onMove);
      domElement.removeEventListener('pointerdown', _onDown);
      domElement.removeEventListener('pointerup',   _onUp);
    };

    this.dispose = this.deactivate;
  }

  DragControls.prototype = Object.create(THREE.EventDispatcher.prototype);
  DragControls.prototype.constructor = DragControls;

  // Attach to THREE namespace
  THREE.DragControls = DragControls;

})();
