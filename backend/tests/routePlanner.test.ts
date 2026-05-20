import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildOpenStreetRoutePlan, buildStarterRoutePlan, createDynamicWaypoints, summarizeRoute } from "../src/route/routePlanner.js";

describe("route planner", () => {
  it("builds an empty starter route for a new trip", () => {
    const plan = buildStarterRoutePlan("new-trip", new Date("2026-05-18T00:00:00.000Z"));

    assert.equal(plan.totalDistanceKm, 0);
    assert.equal(plan.summary.suggestedStops, 0);
    assert.equal(plan.summary.weatherAlerts, 0);
    assert.equal(plan.summary.borderAlerts, 0);
    assert.equal(plan.summary.nextCriticalStop, null);
    assert.equal(plan.geometry.length, 0);
    assert.equal(plan.waypoints.length, 0);
  });

  it("creates dynamic route waypoints from routed geometry", () => {
    const waypoints = createDynamicWaypoints(
      {
        name: "Start City",
        region: "Start Region",
        coordinate: { lat: 21.0278, lng: 105.8342 },
      },
      {
        name: "Finish City",
        region: "Finish Region",
        coordinate: { lat: 16.0544, lng: 108.2022 },
      },
      [
        { lat: 21.0278, lng: 105.8342 },
        { lat: 18.6, lng: 106.1 },
        { lat: 16.0544, lng: 108.2022 },
      ],
      760,
      920,
    );

    assert.equal(waypoints.length, 3);
    assert.equal(waypoints[1]?.stop?.kind, "rest");
    assert.equal(waypoints[2]?.distanceFromStartKm, 760);
  });

  it("builds a dynamic route from a GPS origin coordinate", async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (url) => {
      const href = String(url);

      if (href.includes("/search")) {
        return {
          ok: true,
          json: async () => [
            {
              display_name: "Hai Phong, Viet Nam",
              lat: "20.8449",
              lon: "106.6881",
              address: { city: "Hai Phong" },
            },
          ],
        } as Response;
      }

      if (href.includes("/v1/forecast")) {
        return {
          ok: true,
          json: async () => ({
            current: {
              time: "2026-05-19T08:00",
              temperature_2m: 27.4,
              precipitation: 1.2,
              wind_speed_10m: 18.6,
              weather_code: 80,
            },
            hourly: {
              time: ["2026-05-19T08:00"],
              precipitation_probability: [66],
            },
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({
          code: "Ok",
          routes: [
            {
              distance: 108000,
              duration: 5400,
              geometry: {
                coordinates: [
                  [105.8342, 21.0278],
                  [106.1, 20.95],
                  [106.6881, 20.8449],
                ],
                type: "LineString",
              },
            },
          ],
        }),
      } as Response;
    }) as typeof fetch;

    try {
      const plan = await buildOpenStreetRoutePlan("trip-1", {
        origin: "Vi tri cua toi",
        originCoordinate: { lat: 21.0278, lng: 105.8342 },
        destination: "Hai Phong",
      });

      assert.equal(plan.origin, "Vi tri cua toi");
      assert.equal(plan.destination, "Hai Phong, Viet Nam");
      assert.equal(plan.totalDistanceKm, 108);
      assert.equal(plan.geometry.length, 3);
      assert.equal(plan.waypoints[0]?.weather.source, "open-meteo");
      assert.equal(plan.waypoints[0]?.weather.rainChance, 66);
      assert.equal(plan.summary.weatherAlerts, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("summarizes an empty route safely", () => {
    assert.deepEqual(summarizeRoute([]), {
      suggestedStops: 0,
      weatherAlerts: 0,
      borderAlerts: 0,
      nextCriticalStop: null,
    });
  });
});
