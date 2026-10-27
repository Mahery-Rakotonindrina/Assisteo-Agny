import { describe, expect, it } from "vitest";
import { absoluteUrl, appStructuredData, jsonLd, PUBLIC_PAGES, robotsTxt, sitemapXml } from "@/lib/seo";

const site = "https://assisteo-agny.vercel.app";

describe("absoluteUrl", () => {
  it("joins the site and the path, without a slash after the home page", () => {
    expect(absoluteUrl(site, "/")).toBe(site);
    expect(absoluteUrl(site, "/plans")).toBe(`${site}/plans`);
  });
  it("gives nothing when the site address is unknown", () => {
    expect(absoluteUrl("", "/plans")).toBeNull();
  });
});

describe("robotsTxt", () => {
  it("keeps the API and admin out and points to the sitemap", () => {
    const robots = robotsTxt(site);
    expect(robots).toContain("Disallow: /api/");
    expect(robots).toContain("Disallow: /admin");
    expect(robots).toContain(`Sitemap: ${site}/sitemap.xml`);
  });
  it("leaves out the sitemap line without a site address", () => {
    expect(robotsTxt("")).not.toContain("Sitemap:");
  });
});

describe("sitemapXml", () => {
  it("lists every public page and only those", () => {
    const xml = sitemapXml(site);
    expect(xml.match(/<loc>/g)).toHaveLength(PUBLIC_PAGES.length);
    expect(xml).toContain(`<loc>${site}/plans</loc>`);
    expect(xml).not.toMatch(/history|parcels|settings|admin/);
  });
  it("dates the legal pages", () => {
    expect(sitemapXml(site)).toMatch(/\/privacy<\/loc><lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  });
});

describe("jsonLd", () => {
  it("can never close its script tag, and still reads back the same", () => {
    const data = { name: "</script><script>alert(1)</script>" };
    const json = jsonLd(data);
    expect(json).not.toContain("<");
    expect(JSON.parse(json)).toEqual(data);
  });
});

describe("appStructuredData", () => {
  it("describes the app as free to start, in ariary", () => {
    const data = appStructuredData(site, "Description");
    const app = data["@graph"].find((node) => node["@type"] === "WebApplication");
    expect(app).toMatchObject({ url: site, description: "Description", offers: { price: "0", priceCurrency: "MGA" } });
  });
});
