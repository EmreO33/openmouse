import {
  eggWeMergeLogicalDevices,
} from "@openmouse/protocol/drivers/endgame/egg-we-control";
import { collapseBoltPeers } from "@openmouse/protocol/drivers/logitech/bolt";
import { RazerHidClient } from "@openmouse/protocol/drivers/razer/hid";
import {
  clientSupportScore as registryClientSupportScore,
  createSupportedClient as registryCreateSupportedClient,
  deviceBrand,
  type PulsarClient,
  type SupportedClient,
} from "@openmouse/protocol/drivers/registry";
import { RAZER_PRODUCTS } from "@openmouse/protocol/razer-devices";
export { describeHidDevice } from "./hid-diagnostics.ts";
export { deviceBrand, type PulsarClient, type SupportedClient };

type NativeBridgeDevice = HIDDevice & { openMouseTransport?: "bridge" };

function isNativeOnlyBridgeRazer(device: HIDDevice): boolean {
  return (device as NativeBridgeDevice).openMouseTransport === "bridge"
    && device.vendorId === 0x1532
    && RAZER_PRODUCTS.get(device.productId)?.nativeOnly === true;
}

export function createSupportedClient(device: HIDDevice): SupportedClient | null {
  return registryCreateSupportedClient(device)
    ?? (isNativeOnlyBridgeRazer(device) ? new RazerHidClient(device) : null);
}

export function clientSupportScore(device: HIDDevice): number {
  return isNativeOnlyBridgeRazer(device)
    ? 10_000
    : registryClientSupportScore(device);
}

/** Supported devices for the sidebar; multi-path drivers collapse via their module. */
export function listLogicalDevices(devices: HIDDevice[] = []): HIDDevice[] {
  const afterEgg = eggWeMergeLogicalDevices(devices, (device) => createSupportedClient(device) !== null);
  return collapseBoltPeers(afterEgg);
}
