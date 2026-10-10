import type {
  ProviderEndpointRoutingDecision,
  ProviderEndpointRoutingPort,
} from "@zcode/contracts";

/** Ycode: coding-plan gateway routing removed; always pass through original URL. */
export function createStaticProviderEndpointRoutingPort(
  _endpointOrigin: string,
): ProviderEndpointRoutingPort {
  return {
    async resolve(requestUrl): Promise<ProviderEndpointRoutingDecision> {
      return { routed: false, url: requestUrl };
    },
  };
}
