// First-run page: sign in, import the old Google watchlist, then use it. Each step ticks
// itself off as soon as it's done, including from other tabs (e.g. after importing).

(() => {
  const $ = (id) => document.getElementById(id);
  const signinButton = $('signin');
  const signinStatus = $('signin-status');
  const importStatus = $('import-status');

  async function showSignin() {
    const { auth, 'welcome:skippedSignin': skipped } = await chrome.storage.local.get(['auth', 'welcome:skippedSignin']);
    $('step-signin').classList.toggle('done', Boolean(auth || skipped));
    signinButton.hidden = Boolean(auth);
    $('skip').hidden = Boolean(auth || skipped);
    signinStatus.classList.remove('error');
    signinStatus.textContent = auth
      ? `Signed in as ${auth.email}. Your list syncs to this account.`
      : skipped ? 'Your list stays on this browser. You can sign in later from the extension’s icon.' : '';
  }

  async function showImport() {
    const count = (await WL.getAll()).length;
    $('step-import').classList.toggle('done', count > 0);
    importStatus.textContent = count ? `${count === 1 ? '1 title is' : `${count} titles are`} on your list.` : '';
  }

  signinButton.addEventListener('click', async () => {
    signinButton.disabled = true;
    signinStatus.textContent = 'Opening Google sign-in…';
    const res = await chrome.runtime.sendMessage({ type: 'sign-in' });
    signinButton.disabled = false;
    if (!res.ok) {
      signinStatus.classList.add('error');
      signinStatus.textContent = /did not approve|cancel/i.test(res.error) ? 'Sign-in was cancelled. Try again whenever you like.' : 'Sign-in failed: ' + res.error;
      return;
    }
    showSignin();
  });

  $('skip').addEventListener('click', async () => {
    await chrome.storage.local.set({ 'welcome:skippedSignin': true });
    showSignin();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if ('auth' in changes || 'welcome:skippedSignin' in changes) showSignin();
  });
  WL.onChange(showImport);

  showSignin();
  showImport();
})();
