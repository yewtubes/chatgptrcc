// Roblox-specific imports of WebClient.wasm. The originals were EM_JS/EM_ASYNC_JS
// functions whose bodies were not shipped; these are reimplementations based on
// the call sites in the wasm and on what WasmPlayer.js expects.

addToLibrary({
  $rbxLog: (...a) => console.log('[rbx]', ...a),
  $rbxOnce__deps: ['$rbxLog'],
  $rbxOnce: (key, ...a) => {
    rbxOnce.seen ??= new Set();
    if (!rbxOnce.seen.has(key)) { rbxOnce.seen.add(key); rbxLog(key, ...a); }
  },

  // ---- assets -------------------------------------------------------------
  // js_fetch_file(url, dst, size): synchronously downloads `url` into
  // HEAPU8[dst .. dst+size). Returns 0 on success.
  js_fetch_file__deps: ['$UTF8ToString'],
  js_fetch_file: (urlPtr, dst, size) => {
    var url = UTF8ToString(urlPtr);
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.overrideMimeType('text/plain; charset=x-user-defined');
      xhr.send(null);
      if (xhr.status !== 200 && xhr.status !== 0) {
        console.warn('[rbx] js_fetch_file HTTP', xhr.status, url);
        return 1;
      }
      var s = xhr.responseText, n = Math.min(s.length, size);
      if (s.length !== size) console.warn('[rbx] js_fetch_file size mismatch', url, s.length, size);
      for (var i = 0; i < n; i++) HEAPU8[dst + i] = s.charCodeAt(i) & 0xff;
      return 0;
    } catch (e) {
      console.warn('[rbx] js_fetch_file failed', url, e);
      return 1;
    }
  },

  // ---- OPFS asset cache: reported as empty/unavailable ---------------------
  rbx_opfs_install_helpers__deps: ['$rbxOnce'],
  rbx_opfs_install_helpers: (a, b) => rbxOnce('opfs_install_helpers', a, b),
  __asyncjs__rbx_opfs_open__async: true,
  __asyncjs__rbx_opfs_open__deps: ['$rbxOnce', '$UTF8ToString'],
  __asyncjs__rbx_opfs_open: (name, tid) => { rbxOnce('opfs_open', UTF8ToString(name), tid); },
  __asyncjs__rbx_opfs_file_size__async: true,
  __asyncjs__rbx_opfs_file_size: (k) => 0,
  __asyncjs__rbx_opfs_contains__async: true,
  __asyncjs__rbx_opfs_contains: (k) => 0,
  rbx_opfs_read_sync_if_cached: (a, b, c, d) => 0,
  __asyncjs__rbx_opfs_get_buffer_offset__async: true,
  __asyncjs__rbx_opfs_get_buffer_offset: (a, b, c, d, e) => 0,
  __asyncjs__rbx_opfs_set__async: true,
  __asyncjs__rbx_opfs_set: (k, p, n) => 0,
  __asyncjs__rbx_opfs_remove__async: true,
  __asyncjs__rbx_opfs_remove: (k) => 0,
  __asyncjs__rbx_opfs_list_sized__async: true,
  __asyncjs__rbx_opfs_list_sized: (a, b) => 0,
  __asyncjs__rbx_opfs_remove_batch__async: true,
  __asyncjs__rbx_opfs_remove_batch: (a) => 0,
  rbx_opfs_free: (p) => {},
  __asyncjs__rbx_opfs_list__async: true,
  __asyncjs__rbx_opfs_list: (a, b) => 0,
  rbx_opfs_close: (a) => {},
  __asyncjs__rbx_opfs_get_offset__async: true,
  __asyncjs__rbx_opfs_get_offset: (a, b, c, d) => 0,
  __asyncjs__rbx_opfs_get__async: true,
  __asyncjs__rbx_opfs_get: (a, b) => 0,
  __asyncjs__rbx_opfs_clear__async: true,
  __asyncjs__rbx_opfs_clear: () => 0,
  __asyncjs__rbx_opfs_get_buffer__async: true,
  __asyncjs__rbx_opfs_get_buffer: (a, b, c) => 0,

  // ---- threading / scheduling ---------------------------------------------
  // Futex wait for the main thread, which may not block: suspends via JSPI.
  // Returns 0 ok, 1 not-equal, 2 timed-out (indexes into the wasm's table).
  __asyncjs__rbxFutexWaitMainJspi__async: true,
  // Answer synchronously whenever possible: returning a promise makes JSPI
  // suspend and resume the whole main-thread stack, and spin-waits on a
  // contended lock otherwise turn into a flood of suspensions.
  __asyncjs__rbxFutexWaitMainJspi: (addr, val, timeoutMs) => {
    var i = addr >> 2;
    if (Atomics.load(HEAP32, i) !== val) return 1;
    if (!(timeoutMs > 0)) return 2;
    var map = (v) => (v === 'ok' ? 0 : v === 'not-equal' ? 1 : 2);
    var r = Atomics.waitAsync(HEAP32, i, val, timeoutMs === Infinity ? undefined : timeoutMs);
    if (!r.async) return map(r.value);
    // debug: report long waits on the main thread
    var t0 = performance.now();
    var watch = setTimeout(() => console.warn(`[rbx] main-thread futex wait on ${addr} (val ${val}, timeout ${timeoutMs}) pending >3s; now ${Atomics.load(HEAP32, i)}`), 3000);
    return r.value.then((v) => { clearTimeout(watch); var dt = performance.now() - t0; if (dt > 3000) console.warn(`[rbx] futex ${addr} woke after ${dt | 0}ms: ${v}`); return map(v); });
  },

  js_init_ring_buffers: (header, channels) => {
    Module._ringHeaderAddr = header;
    Module._ringChannelsAddr = channels;
  },

  // Fibers on top of JSPI. A context is identified by a token (an address on
  // its own C stack). fiber_transfer_js(from, to) parks the caller under `from`
  // and resumes whoever is parked under `to`. The shadow stack pointer and
  // limits are saved/restored per context.
  $rbxFibers: { parked: new Map(), created: 0, destroyed: 0, transfers: 0 },
  $rbxFiberSave: () => ({ sp: _get_stack_ptr(), base: _get_stack_base(), end: _get_stack_end() }),
  $rbxFiberRestore: (st) => { _set_stack_limits(st.base, st.end); _set_stack_ptr(st.sp); },
  $rbxFiberPark__deps: ['$rbxFibers', '$rbxFiberSave', '$rbxFiberRestore'],
  $rbxFiberPark: (token) => {
    var st = rbxFiberSave();
    return new Promise((resolve) => rbxFibers.parked.set(token, resolve)).then((v) => {
      rbxFiberRestore(st);
      return v;
    });
  },
  $rbxFiberWake__deps: ['$rbxFibers'],
  $rbxFiberWake: (token, value) => {
    var r = rbxFibers.parked.get(token);
    if (!r) throw new Error('fiber_transfer to unknown context ' + token);
    rbxFibers.parked.delete(token);
    r(value);
  },
  __asyncjs__fiber_transfer_js__async: true,
  __asyncjs__fiber_transfer_js__deps: ['$rbxFiberPark', '$rbxFiberWake', '$rbxFibers'],
  __asyncjs__fiber_transfer_js: (from, to) => {
    rbxFibers.transfers++;
    var p = rbxFiberPark(from);
    var pending = rbxFibers.pendingCreate;
    if (pending && pending.creator === to) {
      // First transfer out of a freshly created fiber: hand its token back.
      rbxFibers.pendingCreate = null;
      pending.resolve(from);
    } else {
      rbxFiberWake(to, from || 1);
    }
    return p;
  },
  // create_suspended_fiber_js(creatorToken, stackTop, stackLow, fn, arg):
  // starts fiber_entry(creatorToken, fn, arg) on the new stack; fiber_entry
  // immediately transfers back, and its token becomes the fiber handle.
  __asyncjs__create_suspended_fiber_js__async: true,
  __asyncjs__create_suspended_fiber_js__deps: ['$rbxFibers', '$rbxFiberSave', '$rbxFiberRestore'],
  __asyncjs__create_suspended_fiber_js: async (creator, stackTop, stackLow, fn, arg) => {
    var st = rbxFiberSave();
    var handle = new Promise((resolve) => { rbxFibers.pendingCreate = { creator, resolve }; });
    _set_stack_limits(stackTop, stackLow);
    _set_stack_ptr(stackTop);
    rbxFibers.created++;
    if (!rbxFibers.statsTimer) rbxFibers.statsTimer = setInterval(() => console.log(`[rbx] fibers created=${rbxFibers.created} destroyed=${rbxFibers.destroyed} parked=${rbxFibers.parked.size} transfers=${rbxFibers.transfers}`), 5000);
    var done = _fiber_entry(creator, fn, arg);
    Promise.resolve(done).catch((e) => console.error('[rbx] fiber died', e));
    var h = await handle;
    rbxFiberRestore(st);
    return h;
  },
  fiber_destroy_js__deps: ['$rbxFibers'],
  fiber_destroy_js: (token) => { rbxFibers.destroyed++; rbxFibers.parked.delete(token); },

  // main() calls this once; drive main_loop_iteration from rAF.
  schedule_main_loop__deps: ['$callUserCallback'],
  schedule_main_loop: () => {
    var running = false;
    var tick = async () => {
      if (!running) {
        running = true;
        try {
          await _main_loop_iteration();
          Module._drainTx?.();
        } catch (e) {
          console.error('[rbx] main_loop_iteration threw', e);
          throw e;
        } finally {
          running = false;
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },

  // msync on mmapped files: the engine has no Emscripten FS, nothing to flush.
  _msync_js__deps: [],
  _msync_js: (addr, len, prot, flags, fd, offset) => 0,

  get_hardware_concurrency: () => navigator.hardwareConcurrency || 4,
  read_host_info_int: (key) => {
    var v = Module.hostInfo?.[UTF8ToString(key)];
    return typeof v === 'boolean' ? (v ? 1 : 0) : (v | 0);
  },
  read_host_info_int__deps: ['$UTF8ToString'],
  read_host_info_string__deps: ['$UTF8ToString', '$stringToUTF8'],
  read_host_info_string: (key, buf, size) => {
    var v = Module.hostInfo?.[UTF8ToString(key)];
    stringToUTF8(v == null ? '' : String(v), buf, size);
  },

  // ---- crash reporting / stack traces -------------------------------------
  report_crash__deps: ['$UTF8ToString'],
  report_crash: (a, b, c, d, e) => {
    var s = (p) => (p ? UTF8ToString(p) : '');
    console.error('[rbx] report_crash', s(a), s(b), s(c), s(d), e);
  },
  set_crash_attribute__deps: ['$UTF8ToString'],
  set_crash_attribute: (k, v) => console.log('[rbx] crash attribute', UTF8ToString(k), '=', UTF8ToString(v)),
  RBX_setFullWasmStackTrace: () => { var old = Error.stackTraceLimit; Error.stackTraceLimit = Infinity; return old ?? 10; },
  RBX_restoreWasmStackTraceLimit: (v) => { Error.stackTraceLimit = v; },
  HaveOffsetConverter: () => 0,

  // ---- input / canvas -----------------------------------------------------
  get_effective_device_pixel_ratio: () => Module.getEffectiveDevicePixelRatio ? Module.getEffectiveDevicePixelRatio() : (window.devicePixelRatio || 1),
  applyPendingCanvasResize: (wPtr, hPtr) => {
    if (!Module.applyPendingResize || !Module.applyPendingResize()) return 0;
    HEAP32[wPtr >> 2] = Module.canvas.width;
    HEAP32[hPtr >> 2] = Module.canvas.height;
    return 1;
  },
  is_touch_mobile: () => /Mobi|Android|iPad|iPhone/i.test(navigator.userAgent) ? 1 : 0,
  is_touch_screen_device: () => (navigator.maxTouchPoints || 0) > 0 ? 1 : 0,
  has_keyboard: () => 1,
  has_mouse: () => (matchMedia('(pointer: fine)').matches || !(navigator.maxTouchPoints > 0)) ? 1 : 0,
  is_legacy_scroll: () => Module.isMouseLegacyScroll ? 1 : 0,
  preallocate_emscripten_key_event_buffer: (n) => {},

  // Native text box overlay used for TextBox editing. Kept minimal: state is
  // recorded and the hidden input element is focused/blurred.
  $rbxText: { horiz: 0, vert: 0, overlay: 0 },
  update_text_box_rect: (x, y, w, h) => { rbxText.rect = [x, y, w, h]; },
  update_text_box_rect__deps: ['$rbxText'],
  copy_pending_text: (dst) => {
    if (Module.pendingBytes) HEAPU8.set(Module.pendingBytes, dst);
  },
  sync_text_and_pos__deps: ['$UTF8ToString'],
  sync_text_and_pos: (textPtr, selStart, selEnd) => {
    var el = Module.inputElement;
    if (!el) return;
    var text = UTF8ToString(textPtr);
    el.value = text;
    try { el.setSelectionRange(selStart, selEnd); } catch (e) {}
  },
  set_text_box_horiz_alignment: (a) => {},
  set_text_box_vert_alignment: (a) => {},
  choose_current_text_input: (multiline, a, b) => {},
  setup_font: (a, b, c, size, d) => {},
  set_text_color: (r, g, b, a) => {},
  set_text_box_overlay: (on) => {},
  focus_text_input: () => { try { Module.inputElement?.focus({ preventScroll: true }); } catch (e) {} },
  blur_text_input: () => { try { Module.inputElement?.blur(); } catch (e) {} },
  reset_current_text_input: () => { if (Module.inputElement) Module.inputElement.value = ''; },
  shift_canvas: (dy) => {},

  // ---- shaders: the bundled pack is the desktop GLSL 1.50 one (the web build's
  // glsles3_web pack is not public), so convert to GLSL ES 3.00 on the fly.
  $rbxConvertShader: (src) => {
    if (!/^\s*#version 150/.test(src)) return src;
    var isFrag = /\bgl_FragCoord\b|\bout\s+(highp\s+|mediump\s+)?(vec4|float|ivec4|uvec4)\s+\w+\s*;/.test(src) && !/\bgl_Position\b/.test(src);
    var pre = ['#version 300 es'];
    if (/\bnoperspective\b/.test(src)) pre.push('#extension GL_NV_shader_noperspective_interpolation : enable');
    if (/\bgl_ClipDistance\b/.test(src)) pre.push('#extension GL_EXT_clip_cull_distance : enable');
    pre.push('precision highp float;', 'precision highp int;', 'precision highp sampler2D;',
      'precision highp sampler3D;', 'precision highp samplerCube;', 'precision highp sampler2DArray;',
      'precision highp sampler2DShadow;', 'precision highp samplerCubeShadow;', 'precision highp sampler2DArrayShadow;',
      'precision highp isampler2D;', 'precision highp usampler2D;', 'precision highp isampler3D;', 'precision highp usampler3D;');
    return src
      .replace(/^\s*#version 150[^\n]*/, pre.join('\n'))
      .replace(/^\s*#extension GL_ARB_[^\n]*$/mg, '');
  },

  // ---- GL buffer mapping (not in WebGL2): emulate with a heap shadow --------
  $rbxMapped: {},
  glMapBufferRange__deps: ['$rbxMapped', 'malloc'],
  glMapBufferRange: (target, offset, length, access) => {
    var ptr = _malloc(length);
    if (!ptr) return 0;
    rbxMapped[target] = { ptr, offset, length, access };
    return ptr;
  },
  glUnmapBuffer__deps: ['$rbxMapped', '$GL', 'free'],
  glUnmapBuffer: (target) => {
    var m = rbxMapped[target];
    if (!m) return 0;
    delete rbxMapped[target];
    if (m.access & 0x2 /* GL_MAP_WRITE_BIT */) {
      GLctx.bufferSubData(target, m.offset, HEAPU8, m.ptr, m.length);
    }
    _free(m.ptr);
    return 1;
  },

  // ---- RNA transport (QUIC-like over WebTransport); reported unsupported so
  // the engine uses its UDP/RakNet path through the ring buffers instead.
  rbx_wasm_rna_is_supported_js: () => 0,
  rbx_wasm_rna_connect_js: (...a) => console.warn('[rbx] rna_connect (unsupported)', a),
  rbx_wasm_rna_resume_stream_read_js: (a, b) => {},
  rbx_wasm_rna_receive_ring_consumed_js: (a, b, c) => {},
  rbx_wasm_rna_shutdown_stream_read_js: (a, b) => {},
  rbx_wasm_rna_pause_stream_read_js: (a, b) => {},
  rbx_wasm_rna_shutdown_stream_write_js: (a, b) => {},
  rbx_wasm_rna_send_connection_close_js: (a) => {},
  rbx_wasm_rna_write_stream_js: (a, b, c, d) => {},
  rbx_wasm_rna_open_stream_js: (a, b) => {},
  rbx_wasm_rna_close_js: (a) => {},
  rbx_wasm_rna_send_datagram_js: (a, b, c, d, e) => {},
});
