import { isCourierService, type CourierConfig } from './types';

/** The partner keeps its sender address; the parcel's service chooses the barcode. */
export function serviceConfig(config: CourierConfig | null | undefined, service?: string | null): CourierConfig | null {
  if (!config) return null;
  if (!isCourierService(service)) return config;
  return { ...config, tracking: service === 'delhivery' ? 'delhivery' : undefined, sheet_title: undefined };
}
