/**
 * Expo config.
 *
 * Everything static lives in app.json; this wrapper exists so the web base
 * path can come from the environment. GitHub Pages serves a project site at
 * /<repo>/, but a custom domain pointed at this repo alone serves it at /,
 * and the bundle's asset URLs have to match whichever it is.
 *
 *   PAGES_BASE_PATH=/vinylCompanionApp   → https://<user>.github.io/vinylCompanionApp/
 *                                          (also pyjournal.me/vinylCompanionApp/)
 *   PAGES_BASE_PATH=""                   → a domain dedicated to this app
 *
 * scripts/build-web.mjs reads the same variable, so the manifest, service
 * worker scope, and injected tags stay in step with the bundle.
 */

const DEFAULT_BASE_PATH = '/vinylCompanionApp';

function basePath() {
  const raw = process.env.PAGES_BASE_PATH;
  // Unset → default. Explicitly empty → root, which is a meaningful choice.
  if (raw === undefined) return DEFAULT_BASE_PATH;
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

module.exports = ({ config }) => ({
  ...config,
  experiments: {
    ...config.experiments,
    baseUrl: basePath(),
  },
});
