// Local stand-in for the Roblox web APIs the client calls. Nothing is forwarded
// to Roblox: requests the engine (or WasmPlayer.js) makes to *.roblox.com /
// *.rbxcdn.com arrive here as /proxy/<url> and are answered locally.
//
// Assets come from webclient/assets/ (files named by asset id, or
// hash/<hash> for hash-addressed content); see tools/import_asset.js.
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'webclient', 'assets');
const FLAGS = path.join(ROOT, 'webclient', 'LocalFlags.json');

const USER = { id: 1, name: 'Player1', displayName: 'Player1' };

// Assets are genuine Roblox content: anything not yet in the local store is
// fetched once from Roblox's public asset delivery and cached in
// webclient/assets/ (set ASSET_FETCH=0 to stay fully offline).
const { execFile } = require('child_process');
const fetching = new Map();
const noFetch = new Set();
function curl(args) {
  return new Promise((resolve, reject) =>
    execFile('curl', ['-sS', '-m', '60', '--compressed', ...args], { encoding: 'buffer', maxBuffer: 1 << 30 },
      (err, out) => (err ? reject(err) : resolve(out))));
}
function fetchAsset(id) {
  id = String(id);
  if (process.env.ASSET_FETCH === '0' || !/^\d+$/.test(id) || noFetch.has(id)) return Promise.resolve(false);
  if (assetFile(id)) return Promise.resolve(true);
  if (!fetching.has(id)) {
    fetching.set(id, (async () => {
      try {
        const meta = JSON.parse((await curl([`https://assetdelivery.roblox.com/v2/assetId/${id}`])).toString());
        const loc = meta.locations && meta.locations[0] && meta.locations[0].location;
        if (!loc) throw new Error((meta.errors && meta.errors[0] && meta.errors[0].message) || 'no location');
        const data = await curl(['-L', loc]);
        fs.mkdirSync(ASSETS, { recursive: true });
        fs.writeFileSync(path.join(ASSETS, id), data);
        fs.writeFileSync(path.join(ASSETS, `${id}.json`), JSON.stringify({ assetTypeId: meta.assetTypeId }));
        console.log(`backend: cached asset ${id} (type ${meta.assetTypeId}, ${data.length} bytes)`);
        return true;
      } catch (e) {
        noFetch.add(id);
        console.log(`backend: asset ${id} not downloadable: ${e.message.split('\n')[0]}`);
        return false;
      } finally {
        fetching.delete(id);
      }
    })());
  }
  return fetching.get(id);
}
const unhandled = new Set();

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
const notFound = (res, what) => json(res, 404, { errors: [{ code: 404, message: `${what} is not available on the local backend` }] });

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function assetFile(id) {
  const f = path.join(ASSETS, String(id).replace(/[^0-9]/g, ''));
  return fs.existsSync(f) ? f : null;
}
function assetMeta(id) {
  try { return JSON.parse(fs.readFileSync(path.join(ASSETS, `${id}.json`), 'utf8')); } catch { return {}; }
}
function hashFile(hash) {
  const f = path.join(ASSETS, 'hash', String(hash).replace(/[^0-9a-f]/gi, ''));
  return fs.existsSync(f) ? f : null;
}
function sendFile(res, file) {
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': fs.statSync(file).size });
  fs.createReadStream(file).pipe(res);
}

// Avatar for the local player: classic R6 colours, no catalog assets.
const AVATAR = {
  resolvedAvatarType: process.env.AVATAR_TYPE || 'R15',
  accessoryVersionIds: [], equippedGearVersionIds: [], backpackGearVersionIds: [],
  assetAndAssetTypeIds: [], animationAssetIds: {},
  bodyColors: { headColorId: 24, torsoColorId: 23, rightArmColorId: 24, leftArmColorId: 24, rightLegColorId: 119, leftLegColorId: 119 },
  bodyColor3s: { headColor3: 'F5CD30', torsoColor3: '0D69AC', rightArmColor3: 'F5CD30', leftArmColor3: 'F5CD30', rightLegColor3: 'A4BD47', leftLegColor3: 'A4BD47' },
  scales: { height: 1, width: 1, head: 1, depth: 1, proportion: 0, bodyType: 0 },
  emotes: [],
};

function joinScript(placeId) {
  const host = process.env.RCC_HOST || '127.0.0.1', port = +(process.env.RCC_PORT || 53640);
  const gameId = '00000000-0000-0000-0000-000000000001';
  const session = JSON.stringify({ SessionId: crypto.randomUUID(), GameId: gameId, PlaceId: placeId });
  console.log(`backend: join script -> ${host}:${port}`);
  return {
    jobId: gameId, status: 2, statusData: null, joinScriptUrl: null, authenticationUrl: null,
    authenticationTicket: null, message: null, queuePosition: 0,
    joinScript: {
      ClientPort: 0, MachineAddress: host, ServerPort: port,
      ServerConnections: [{ Address: host, Port: port }], UdmuxEndpoints: [], DirectServerReturn: true,
      TokenGenAlgorithm: 0, PepperId: 0, TokenValue: '', PingUrl: '', PingInterval: 0,
      UserName: USER.name, DisplayName: USER.displayName, SeleniumTestMode: false, UserId: USER.id,
      RobloxLocale: 'en_us', GameLocale: 'en_us', SuperSafeChat: false, FlexibleChatEnabled: false,
      CharacterAppearance: '', ClientTicket: '', GameId: gameId, PlaceId: placeId,
      BaseUrl: 'https://www.roblox.com/', ChatStyle: 'ClassicAndBubble', CreatorId: 1, CreatorTypeEnum: 'User',
      MembershipType: 'None', AccountAge: 365, CookieStoreFirstTimePlayKey: '', CookieStoreFiveMinutePlayKey: '',
      CookieStoreEnabled: false, IsUnknownOrUnder13: false, GameChatType: 'AllUsers', SessionId: session,
      AnalyticsSessionId: '', DataCenterId: 0, UniverseId: 1, FollowUserId: 0, characterAppearanceId: USER.id,
      CountryCode: 'US', RandomSeed1: '', ClientPublicKeyData: '',
    },
  };
}

// [host regex, path regex, handler(req, res, url, body)]
const ROUTES = [
  // Fast flags: engine defaults plus webclient/LocalFlags.json.
  [/^clientsettings(cdn)?\.roblox\.com$/, /^\/v\d\/settings\/application\//, (req, res) => {
    let applicationSettings = {};
    try { applicationSettings = JSON.parse(fs.readFileSync(FLAGS, 'utf8')); } catch {}
    json(res, 200, { applicationSettings });
  }],
  [/^clientsettings(cdn)?\.roblox\.com$/, /./, (req, res) => json(res, 200, {})],

  [/^locale\.roblox\.com$/, /supported-locales|user-locus|locales/, (req, res) => {
    const l = { id: 1, locale: 'en_us', name: 'English', nativeName: 'English', language: { id: 41, name: 'English', nativeName: 'English', languageCode: 'en' } };
    json(res, 200, { signupAndLogin: l, generalExperience: l, ugc: l, data: [l] });
  }],

  [/^users\.roblox\.com$/, /^\/v1\/users\/authenticated\/app-launch-info/, (req, res) => json(res, 200, { ...USER, ageBracket: 0, countryCode: 'US', isPremium: false })],
  [/^users\.roblox\.com$/, /^\/v1\/users\/authenticated/, (req, res) => json(res, 200, USER)],
  [/^users\.roblox\.com$/, /^\/v1\/users\/\d+$/, (req, res) => json(res, 200, { ...USER, description: '', created: '2006-01-01T00:00:00Z', isBanned: false, hasVerifiedBadge: false })],
  [/^users\.roblox\.com$/, /^\/v1\/users$/, (req, res) => json(res, 200, { data: [USER] })],

  [/^avatar\.roblox\.com$/, /avatar-fetch|\/avatar$/, (req, res) => json(res, 200, AVATAR)],
  [/^avatar\.roblox\.com$/, /./, (req, res) => json(res, 200, { data: [] })],

  [/^thumbnails\.roblox\.com$/, /./, (req, res) => json(res, 200, { data: [] })],

  // Asset delivery from the local store.
  [/^assetdelivery\.roblox\.com$/, /^\/v1\/assets\/batch/, async (req, res, u, body) => {
    let items = [];
    try { items = JSON.parse(body.toString() || '[]'); } catch {}
    await Promise.all(items.map((it) => (it.assetId ?? it.AssetId) && fetchAsset(it.assetId ?? it.AssetId)));
    json(res, 200, items.map((it) => {
      const id = it.assetId ?? it.AssetId;
      const hash = it.hash ?? it.Hash;
      const base = { requestId: it.requestId ?? it.RequestId, isArchived: false, isRecordable: true };
      if (id && assetFile(id))
        return { ...base, location: `https://assetdelivery.roblox.com/v1/asset/?id=${id}`, assetTypeId: assetMeta(id).assetTypeId ?? 0 };
      if (hash && hashFile(hash))
        return { ...base, location: `https://assetdelivery.roblox.com/v1/asset/?hash=${hash}`, assetTypeId: 0 };
      unhandledAsset(id ?? hash);
      return { ...base, errors: [{ code: 404, message: 'Asset not in local store' }] };
    }));
  }],
  [/^assetdelivery\.roblox\.com$/, /^\/v\d\/asset(Id\/\d+)?/, async (req, res, u) => {
    const id = u.searchParams.get('id') || (/assetId\/(\d+)/.exec(u.pathname) || [])[1];
    if (id) await fetchAsset(id);
    const hash = u.searchParams.get('hash');
    const f = (id && assetFile(id)) || (hash && hashFile(hash));
    if (f) return sendFile(res, f);
    unhandledAsset(id ?? hash);
    notFound(res, `asset ${id ?? hash}`);
  }],

  [/^gamejoin\.roblox\.com$/, /^\/v1\/join-game/, async (req, res, u, body) => {
    let placeId = +(process.env.PLACE_ID || 1818);
    try { placeId = JSON.parse(body.toString()).placeId || placeId; } catch {}
    json(res, 200, joinScript(placeId));
  }],

  // Display names for player lists, chat, etc.
  [/^apis\.roblox\.com$/, /^\/user-profile-api\/v1\/user\/profiles\/get-profiles/, async (req, res, u, body) => {
    let ids = [USER.id];
    try { ids = JSON.parse(body.toString()).userIds || ids; } catch {}
    json(res, 200, {
      profileDetails: ids.map((id) => {
        const name = +id === USER.id ? USER.name : `Player${id}`;
        return {
          userId: +id,
          names: { combinedName: name, displayName: name, username: name, alias: '', contactName: '', platformName: '' },
          isVerified: false,
        };
      }),
    });
  }],

  // App policy: allow the defaults.
  [/^apis\.roblox\.com$/, /guac|universal-app-configuration|app-policy/, (req, res) => json(res, 200, {})],
  [/^apis\.roblox\.com$/, /maintenance-status/, (req, res) => json(res, 200, { isAlertVisible: false })],

  // Telemetry and heartbeats are acknowledged and dropped.
  [/^(ephemeralcounters\.api|ecsv2|client-telemetry|metrics|lms|tracing)\.roblox\.com$/, /./, (req, res) => json(res, 200, {})],
  [/./, /experience-signals-ingest|\/pbe$|otel|analytics|telemetry|heartbeat|user-heartbeats/, (req, res) => json(res, 200, {})],
];

// Missing asset ids are appended to webclient/assets/missing.txt so they can be
// fetched once with `node tools/fetch_assets.js --missing`.
function unhandledAsset(key) {
  if (key && !unhandled.has('asset:' + key)) {
    unhandled.add('asset:' + key);
    console.log(`backend: asset ${key} not in local store`);
    if (/^\d+$/.test(String(key))) {
      fs.mkdirSync(ASSETS, { recursive: true });
      fs.appendFileSync(path.join(ASSETS, 'missing.txt'), key + '\n');
    }
  }
}

async function handle(req, res, target) {
  let u;
  try { u = new URL(target); } catch { return notFound(res, 'bad url'); }
  const body = req.method === 'GET' ? Buffer.alloc(0) : await readBody(req);
  for (const [host, p, fn] of ROUTES) {
    if (host.test(u.hostname) && p.test(u.pathname)) {
      if (process.env.VERBOSE) console.log('backend', req.method, u.hostname + u.pathname);
      return fn(req, res, u, body);
    }
  }
  const key = `${req.method} ${u.hostname}${u.pathname.replace(/\d+/g, ':n')}`;
  if (!unhandled.has(key)) { unhandled.add(key); console.log(`backend: unhandled ${key}`); }
  notFound(res, u.hostname + u.pathname);
}

module.exports = { handle };
