# Contributing

Thanks for helping keep Google's watchlist alive. Bug reports, ideas and code are all welcome.

## Reporting a bug or suggesting an idea

Open an [issue](https://github.com/kaizarraja/bring-back-my-google-watchlist/issues/new/choose) and pick **Bug report** or **Feature idea**. For bugs, the most useful details are:

- your browser (Chrome, Brave, Edge…) and the extension's version, shown at the bottom of its toolbar window;
- the Google page where it went wrong (the address, or the search you typed);
- a screenshot.

Google changes its pages often, so "the button disappeared on this movie page" with a link is a great report.

## Making a change

1. **Fork** the repository and create a branch.
2. **Load your copy of the extension**: open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose the `extension` folder. After each edit, click the reload arrow on the extension's card and refresh the Google tab.
3. **Make the change**, then try it (see [Checking your change](#checking-your-change)).
4. **Open a pull request** against `main`. Say what it changes, why, and how you checked it; screenshots help a lot.

Nothing reaches users until the maintainer reviews and merges your pull request and then publishes a new version, so don't worry about breaking anything for anyone.

## How the code is laid out

There's no build step: the extension is plain JavaScript loaded straight from `extension/`, and the website is plain HTML in `docs/`. The README's [How it's built](README.md#how-its-built) section says what each file does.

A few things to keep in mind:

- **Reading Google's pages.** Google's class names change constantly. Find things through attributes that have stayed stable for years instead: `data-attrid`, `data-maindata`, `data-kpid`, `role` and `aria-label`. See `extension/src/google.js`.
- **Anything added to Google's page goes inside a shadow root** (`WLUI.mount` in `extension/src/ui.js`), so Google's CSS and ours never affect each other.
- **Background lookups on Google stay slow and polite** (`extension/src/filler.js`), so people never trip Google's "unusual traffic" check. Please don't speed them up.
- **Match the surrounding code**: same naming, same kind of short comments explaining *why*, no new dependencies unless there's a strong reason.

## Checking your change

There are no automated tests for the extension yet, so check by hand what your change touches:

- a movie page and a TV page on Google (for example `inception` and `breaking bad`): the **Add to watchlist** button under the title, and **Want to watch** in the Watch movie / Watch show section;
- searching `my watchlist`: the list appears at the top of the results;
- the toolbar window, in light and dark mode.

The sync server in `server/` does have end-to-end tests. If you change it:

```bash
cd server
npm install
node test/fake-google.mjs                                                        # terminal 1
GOOGLE_CLIENT_ID=test-client TEST_JWKS_URL=http://127.0.0.1:8790/jwks npx cf dev  # terminal 2
API=http://localhost:5173 node --test test/sync.test.mjs                          # terminal 3
```

## Please don't

- commit keys, tokens or `.pem` files;
- change `extension/src/config.js` (the live server address and Google sign-in client) or the `key` in `manifest.json`: sign-in for everyone depends on them;
- bump the version number or rebuild `docs/bring-back-my-google-watchlist.zip`. The maintainer does that when publishing a release.

## Licence

By contributing, you agree that your contribution is released under the project's [MIT licence](LICENSE).
