// Client error monitoring (web and the Capacitor apps). Loaded lazily, and
// only when a DSN is configured, so it costs nothing otherwise.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  void Promise.all([import("@sentry/nextjs"), import("@/lib/monitoring")])
    .then(([Sentry, { sentryOptions }]) => {
      Sentry.init({
        ...sentryOptions(dsn),
        // Tells web and native apart in the Sentry dashboard.
        initialScope: { tags: { platform: (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.() ?? "web" } },
      });
    })
    .catch(() => undefined);
}
