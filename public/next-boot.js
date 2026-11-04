// Queues the page's chunk list for Turbopack's runtime, as Next's inline script
// would (the site's CSP runs no inline script). The list is the page's JSON
// written by pages/_document.tsx (lib/turbopackBoot.ts). Deferred, it runs
// before the page's chunks, deferred after it.
(function () {
  var data = document.getElementById("__NEXT_BOOT__");
  if (!data) return;
  var boot = JSON.parse(data.textContent);
  var queue = globalThis[boot.global] || (globalThis[boot.global] = []);
  for (var i = 0; i < boot.params.length; i++) queue.push(boot.params[i]);
})();
