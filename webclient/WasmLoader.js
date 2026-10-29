// Stand-in for Roblox's WasmLoader.js: provides the context WasmPlayer.js reads,
// local dev settings, then loads WasmPlayer.js.
(() => {
  const params = new URLSearchParams(location.search);
  const engineBase = params.get('engineBase') || `${location.origin}/engine`;
  window.__wasmLoaderContext = {
    engineBase,
    server: params.get('server') || 'prod',
    channel: params.get('channel'),
    workerStubUrl: `${engineBase}/stub.js`,
  };

  // Flag overrides for local play, e.g. ?flags=FFlagX=True,DFIntY=5
  const flagOverrides = {
    // The OTA Lua App patch is the Studio package's copy, not the web build's,
    // so its signature does not verify.
    FFlagDebugSkipPostTtiSignatureVerification: 'True',
    DFFlagDebugSkipPostTtiSignatureVerification: 'True',
  };
  for (const kv of (params.get('flags') || '').split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    flagOverrides[k] = v ?? 'True';
  }
  let authCookie = params.get('cookie') || 'local-dev';
  window.__wasmDevSettings = {
    baseUrl: params.get('baseUrl') || undefined,
    apiProxy: undefined,
    skipDeviceProbe: true,
    disableRbxTransport: params.get('rbxTransport') === '0',
    get authCookie() { return authCookie; },
    setAuthCookie(c) { authCookie = c; },
    isCookieFromPool: () => false,
    allocateCookieFromPool: async () => null,
    getFlagOverrides: () => flagOverrides,
  };

  const s = document.createElement('script');
  s.src = `${location.origin}/WasmPlayer.js`;
  document.head.appendChild(s);
})();
