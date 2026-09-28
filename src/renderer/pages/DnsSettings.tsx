/**
 * The DNS settings: the choice (automatic, an encrypted provider, one of
 * your own servers, or the network's), and your own DNS servers — added,
 * named, changed and removed here.
 */
import { useState } from "react";
import {
  chosenCustomDns,
  dnsAddressProblem,
  formatDnsAddress,
  parseDnsAddress,
  MAX_CUSTOM_DNS,
  type CustomDnsServer,
  type DnsSetting,
} from "@shared/dns";
import type { Settings } from "@shared/types";
import { EditIcon, PlusIcon, TrashIcon } from "@theme/icons";
import { Row } from "./ui";

function hintFor(s: Settings): string {
  const custom = chosenCustomDns(s.secureDns, s.customDns);
  if (custom?.parsed.kind === "plain")
    return `Every address lookup goes to “${custom.name}” (${custom.address}) only — unencrypted, so best reached at home or through a VPN such as Netbird. If it doesn't answer, pages can't be found.`;
  if (custom) return `Every address lookup is encrypted and goes to “${custom.name}” only.`;
  if (s.secureDns === "automatic")
    return "Uses encrypted DNS whenever your network's DNS provider supports it.";
  if (s.secureDns === "off") return "Addresses are looked up unencrypted by your network.";
  return "Every address lookup is encrypted and goes to this provider only. Names that exist only in your local network may stop working.";
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export function DnsSettings({
  settings,
  set,
}: {
  settings: Settings;
  set: (patch: Partial<Settings>) => void;
}) {
  /** The server being edited: an existing one's ID, "new", or none. */
  const [editing, setEditing] = useState<string | null>(null);
  const servers = settings.customDns;

  const save = (server: CustomDnsServer) => {
    const exists = servers.some((s) => s.id === server.id);
    if (exists) set({ customDns: servers.map((s) => (s.id === server.id ? server : s)) });
    // A server just added is the one to use.
    else set({ customDns: [...servers, server], secureDns: `custom:${server.id}` });
    setEditing(null);
  };

  return (
    <>
      <Row label="DNS" hint={hintFor(settings)}>
        <select
          className="mb-input w-64"
          aria-label="DNS"
          value={settings.secureDns}
          onChange={(e) => set({ secureDns: e.target.value as DnsSetting })}
        >
          <option value="automatic">Automatic</option>
          <option value="quad9">Quad9 — blocks malware domains</option>
          <option value="mullvad">Mullvad</option>
          <option value="cloudflare">Cloudflare</option>
          {servers.length > 0 && (
            <optgroup label="Your DNS servers">
              {servers.map((s) => (
                <option key={s.id} value={`custom:${s.id}`}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          )}
          <option value="off">Off — your network's DNS</option>
        </select>
      </Row>
      <Row
        label="Your DNS servers"
        hint="A DNS server of your own — a Pi-hole or Unbound at home, or one in a VPN such as Netbird — by its IP address and port, or a DNS-over-HTTPS address. Give it a name to find it in the list above."
      >
        <button
          type="button"
          className="mb-btn mb-btn-ghost"
          disabled={editing !== null || servers.length >= MAX_CUSTOM_DNS}
          onClick={() => setEditing("new")}
        >
          <PlusIcon size={15} /> Add DNS server
        </button>
      </Row>
      {servers.map((server) =>
        editing === server.id ? (
          <DnsServerForm
            key={server.id}
            server={server}
            onSave={save}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <Row
            key={server.id}
            label={server.name}
            hint={
              <span className="font-mono">
                {server.address}
                {settings.secureDns === `custom:${server.id}` && (
                  <span className="ml-2 font-sans text-(--mb-accent)">In use</span>
                )}
              </span>
            }
          >
            <div className="flex items-center gap-1">
              {settings.secureDns !== `custom:${server.id}` && (
                <button
                  type="button"
                  className="mb-btn mb-btn-ghost mb-btn-sm"
                  onClick={() => set({ secureDns: `custom:${server.id}` })}
                >
                  Use
                </button>
              )}
              <button
                type="button"
                className="mb-icon-btn"
                aria-label={`Edit ${server.name}`}
                disabled={editing !== null}
                onClick={() => setEditing(server.id)}
              >
                <EditIcon />
              </button>
              <button
                type="button"
                className="mb-icon-btn"
                aria-label={`Remove ${server.name}`}
                onClick={() => set({ customDns: servers.filter((s) => s.id !== server.id) })}
              >
                <TrashIcon />
              </button>
            </div>
          </Row>
        ),
      )}
      {editing === "new" && (
        <DnsServerForm
          server={{ id: newId(), name: "", address: "" }}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}
    </>
  );
}

function DnsServerForm({
  server,
  onSave,
  onCancel,
}: {
  server: CustomDnsServer;
  onSave: (server: CustomDnsServer) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(server.name);
  const [address, setAddress] = useState(server.address);
  const [tried, setTried] = useState(false);
  const problem = !name.trim() ? "Give it a name." : dnsAddressProblem(address);

  return (
    <form
      className="flex flex-col gap-2.5 border-b border-(--mb-border) px-5 py-3.5 last:border-b-0"
      aria-label={server.name ? `Edit ${server.name}` : "New DNS server"}
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        const parsed = parseDnsAddress(address);
        if (problem || !parsed) return;
        onSave({ id: server.id, name: name.trim(), address: formatDnsAddress(parsed) });
      }}
    >
      <div className="flex flex-wrap gap-2">
        <input
          className="mb-input min-w-40 flex-1"
          aria-label="Name"
          placeholder="Name, e.g. Home DNS (Netbird)"
          value={name}
          maxLength={64}
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="mb-input min-w-60 flex-[2] font-mono"
          aria-label="Address"
          placeholder="192.168.1.2:5335 or https://dns.example/dns-query"
          value={address}
          maxLength={2048}
          spellCheck={false}
          onChange={(e) => setAddress(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-2">
        <p
          className="m-0 flex-1 text-xs text-(--mb-danger)"
          role={tried && problem ? "alert" : undefined}
        >
          {tried ? problem : ""}
        </p>
        <button type="button" className="mb-btn mb-btn-ghost mb-btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="mb-btn mb-btn-primary mb-btn-sm">
          Save
        </button>
      </div>
    </form>
  );
}
