// Where the sync server lives, the "Sign in with Google" app it trusts, and where the
// popup checks for a newer version (this extension is installed by hand, so it can't
// update itself).
globalThis.WL_CONFIG = {
  apiBase: 'https://my-watchlist-sync.kaizar1717.workers.dev',
  googleClientId: '422245580735-859ric3u6tg6o0bflo10p6n34f8sjvgr.apps.googleusercontent.com',
  homepage: 'https://kaizarraja.github.io/bring-back-my-google-watchlist/',
  versionUrl: 'https://kaizarraja.github.io/bring-back-my-google-watchlist/version.json',
};
