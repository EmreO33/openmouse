import assert from "node:assert/strict";
import test from "node:test";

import { describeHidDevice } from "./hid-diagnostics.ts";
import { createSupportedClient } from "./device-clients.ts";

test("HID diagnostics include device IDs and report collections", () => {
  const device = {
    productName: "Example Mouse",
    vendorId: 0x1234,
    productId: 0xabcd,
    collections: [{
      usagePage: 0xff00,
      usage: 1,
      featureReports: [{ reportId: 7 }],
    }],
  } as unknown as HIDDevice;

  assert.equal(
    describeHidDevice(device),
    "Example Mouse (VID 0x1234 PID 0xabcd; usage 0xff00:1 feat[0x7])",
  );
});

test("native Bridge exposes protected Razer products without widening WebHID", () => {
  const protectedRazer = {
    productName: "Razer Viper Ultimate",
    vendorId: 0x1532,
    productId: 0x007b,
    collections: [],
    opened: false,
  } as unknown as HIDDevice;

  assert.equal(createSupportedClient(protectedRazer), null);
  assert.notEqual(
    createSupportedClient(Object.assign(protectedRazer, { openMouseTransport: "bridge" })),
    null,
  );
});
