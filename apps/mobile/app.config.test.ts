import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import { afterEach, expect, it, vi } from "vite-plus/test";

import appleAppSiteAssociation from "../web/public/.well-known/apple-app-site-association.json";
import assetLinks from "../web/public/.well-known/assetlinks.json";

// Keep config parsing independent of local env files and build credentials.
vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () => process.env,
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadConfig(variant: string | undefined) {
  vi.resetModules();
  vi.stubEnv("APP_VARIANT", variant);
  return (await import("./app.config.ts")).default;
}

it.each(["prod", ""])("rejects APP_VARIANT=%j before selecting production IDs", async (value) => {
  await expect(loadConfig(value)).rejects.toThrow(
    "APP_VARIANT must be development, preview, or production.",
  );
});

it.each([
  [undefined, "com.t3tools.t3code"],
  ["development", "com.t3tools.t3code.dev"],
  ["preview", "com.t3tools.t3code.preview"],
  ["production", "com.t3tools.t3code"],
])("keeps the iOS and Android identifiers for APP_VARIANT=%j", async (value, identifier) => {
  const config = await loadConfig(value);
  expect(config.ios?.bundleIdentifier).toBe(identifier);
  expect(config.android?.package).toBe(identifier);
  // Copied thread links open this app only while app.t3.codes lists it.
  const host = new URL(DEFAULT_HOSTED_APP_URL).host;
  expect(config.ios?.associatedDomains).toContain(`applinks:${host}`);
  expect(appleAppSiteAssociation.applinks.details[0]?.appIDs).toContain(
    `${config.ios?.appleTeamId}.${identifier}`,
  );
  expect(config.android?.intentFilters?.[0]?.data).toEqual([
    { scheme: "https", host, pathPrefix: "/threads/" },
  ]);
  expect(assetLinks.map((link) => link.target.package_name)).toContain(identifier);
});

it("builds the iOS 17 client without an upstream update endpoint", async () => {
  vi.stubEnv("T3CODE_IOS17_BUILD", "1");
  vi.stubEnv("MOBILE_VERSION_POLICY", "appVersion");
  const config = await loadConfig("production");
  expect(config.ios?.bundleIdentifier).toBe("local.t3code.ios17");
  expect(config.platforms).toEqual(["ios"]);
  expect(config.runtimeVersion).toEqual({ policy: "fingerprint" });
  expect(config.updates?.enabled).toBe(false);
  expect(config.updates?.url).toBeUndefined();
  expect(config.extra?.eas.projectId).toBeUndefined();
});

it("uses the fork's Expo project and embeds its iOS update channel", async () => {
  const projectId = "12345678-1234-1234-1234-123456789abc";
  vi.stubEnv("T3CODE_IOS17_BUILD", "1");
  vi.stubEnv("T3CODE_IOS17_EXPO_PROJECT_ID", projectId);
  vi.stubEnv("T3CODE_IOS17_EXPO_OWNER", "test-account");
  vi.stubEnv("T3CODE_IOS17_EXPO_SLUG", "t3-ios17-test");
  vi.stubEnv("T3CODE_IOS17_BUNDLE_ID", "com.example.t3code.ios17");
  vi.stubEnv("T3CODE_IOS_PERSONAL_TEAM", "1");
  const config = await loadConfig("production");
  expect(config.owner).toBe("test-account");
  expect(config.slug).toBe("t3-ios17-test");
  expect(config.ios?.bundleIdentifier).toBe("com.example.t3code.ios17");
  expect(config.extra?.eas.projectId).toBe(projectId);
  expect(config.plugins).toContainEqual([
    "expo-notifications",
    expect.objectContaining({ enableRemoteNotifications: false }),
  ]);
  expect(config.updates).toMatchObject({
    enabled: true,
    url: `https://u.expo.dev/${projectId}`,
    requestHeaders: { "expo-channel-name": "ios17" },
  });
});

it("rejects the upstream Expo project in the iOS 17 build", async () => {
  vi.stubEnv("T3CODE_IOS17_BUILD", "1");
  vi.stubEnv("T3CODE_IOS17_EXPO_PROJECT_ID", "d763fcb8-d37c-41ea-a773-b54a0ab4a454");
  vi.stubEnv("T3CODE_IOS17_EXPO_OWNER", "pingdotgg");
  vi.stubEnv("T3CODE_IOS17_EXPO_SLUG", "t3-code");
  await expect(loadConfig("production")).rejects.toThrow("to your own Expo project");
});
