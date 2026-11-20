import { toIpcChannel, type IpcChannel } from './contract-types';

/** One property of a derived API: its name and its value. */
export type DerivedProperty<TValue> = readonly [name: string, value: TValue];

/**
 * Turns a contract (`domain → name → entry`) into an object of the same domains with one derived
 * property per entry, e.g. a client method per action or a subscribe method per event. The
 * channel is derived once here, so no caller writes a channel name by hand.
 * @param contract An IPC or event contract.
 * @param deriveProperty Builds name and value of the property for one entry.
 * @returns The derived properties, grouped by domain; callers cast it to their typed API.
 */
export function mapContract<TEntry, TValue>(
  contract: Readonly<Record<string, Readonly<Record<string, TEntry>>>>,
  deriveProperty: (name: string, channel: IpcChannel, entry: TEntry) => DerivedProperty<TValue>,
): Record<string, Record<string, TValue>> {
  const derived: Record<string, Record<string, TValue>> = {};

  for (const [domain, entries] of Object.entries(contract)) {
    const domainProperties: Record<string, TValue> = {};
    for (const [name, entry] of Object.entries(entries)) {
      const [propertyName, value] = deriveProperty(name, toIpcChannel(domain, name), entry);
      domainProperties[propertyName] = value;
    }
    derived[domain] = domainProperties;
  }

  return derived;
}
